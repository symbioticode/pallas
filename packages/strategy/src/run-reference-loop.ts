/**
 * Orchestrateur minimal d'intégration bout-en-bout (PALLAS-M12, durci PALLAS-M13).
 *
 * PAS un serveur, PAS un gateway, PAS une UI : un script/fonction qui boucle
 * sur = un cycle de pipeline complet. Il relie pour la PREMIÈRE fois :
 *
 *   ReferenceStrategy (signal) -> sanitizeInput (texte externe) ->
 *   validateTradeWithState (état persistant) -> placeOrder (dry-run strict,
 *   blocage attendu) -> ledger append-only (chaque étape).
 *
 * PALLAS-M13 — transaction durable :
 *  - l'état vit dans `DurableStateStore` : document versionné + checksummé,
 *    lecture FAIL-STOP (corruption = arrêt, jamais d'état neuf silencieux),
 *    écriture atomique + fsync + verrou interprocessus (via @pallas/core).
 *  - chaque décision/ordre porte un `correlationId` unique et un cycle de vie
 *    explicite DECIDED → SUBMITTING → SUBMITTED/AMBIGUOUS → ACKED → TERMINAL.
 *  - AUCUNE émission tant qu'une transition d'état n'est pas durablement
 *    écrite : DECIDED est confié au disque avant la construction du payload,
 *    SUBMITTING avant l'appel réseau (vérifié par tests de crash).
 *
 * Contraintes de mission respectées : jamais de retry après exécution ;
 * rejet respecté (pas d'appel placeOrder) ; dry-run reste bloquant (flag
 * global @pallas/core) ; zero-width / menaces signalées mais jamais soumises ;
 * `signatureSchemaValidated` jamais touché (le payload signé reste "de forme").
 */

import { mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { secp256k1 } from '@noble/curves/secp256k1.js';

import { sanitizeInput } from '@pallas/core';
import { validateTradeWithState, type StateInput, type TradeRequest } from '@pallas/risk';
import {
  AmbiguousOrderError,
  PolymarketClient,
  buildSignedOrderPayload,
  privateKeyToAddress,
  type OrderParams,
} from '@pallas/execution';
import { FileLedger } from '@pallas/ledger';

import { ReferenceStrategy, type ReferenceSignal } from './reference.js';
import {
  DurableStateStore,
  newLifecycle,
  transitionLifecycle,
  type OrderIntent,
} from './durable-state.js';
import {
  enforceKillSwitch,
  isLiveFootprint,
  reconcileOrder,
  reconcileScopeForMarket,
  type ReconcileContext,
} from './reconciliation.js';

export interface ReferenceLoopOptions {
  client: PolymarketClient;
  strategy: ReferenceStrategy;
  /** Instance de ledger PARTAGÉE avec l'appelant : une seule écriture du fichier. */
  ledger: FileLedger;
  statePath: string;
  bankrollUsd: number;
  maxOrderUsd: number;
  maxDrawdownUsd: number;
  /**
   * Signataire "de forme" pour le payload signé dry-run (éphémère si omis).
   * Sa clé publique = l'adresse "maker". Si fournie, l'orchestrateur peut
   * réconcilier la réalité de l'exchange (getOpenOrders, lecture seule L2).
   */
  signer?: { address: string; privKey: Uint8Array | string };
  /** Texte externe à faire passer par sanitizeInput avant tout traitement. */
  externalText?: string | null;
  /**
   * Hook de SIMULATION DE CRASH (tests M13 uniquement) : le cycle jette
   * `CrashSimulationError` après avoir rendu durable la transition donnée,
   * ce qui figure un kill de process à cet instant précis.
   */
  crashAfter?: 'before_decided' | 'decided_written' | 'submitting_written' | 'acked_written' | null;
}

export interface CycleResult {
  cycle: number;
  signal: ReferenceSignal | null;
  allowed: boolean;
  rejected_by: string[];
  correlation_id?: string | null;
  lifecycle_status?: string | null;
  execution: 'dry_run_blocked' | 'execution_error' | 'execution_success' | 'not_attempted';
  ledgerRecords: number;
}

/** Erreur artificielle simulant un crash de process à un point de persistance. */
export class CrashSimulationError extends Error {
  constructor(public readonly crashPoint: string) {
    super(`[simulation] crash du process au point ${crashPoint}`);
    this.name = 'CrashSimulationError';
  }
}

/** Construit le TradeRequest à partir du signal — valeurs neutres NON-prédictives. */
export function buildReferenceTradeRequest(
  signal: ReferenceSignal,
  opts: Pick<ReferenceLoopOptions, 'bankrollUsd' | 'maxOrderUsd' | 'maxDrawdownUsd'>,
): TradeRequest {
  const estValue = Math.round(signal.price * signal.size * 100) / 100;
  const marketImpliedP = clamp01(signal.price);
  return {
    market_id: signal.tokenId,
    side: 'buy',
    price: signal.price,
    quantity: signal.size,
    est_value_usd: estValue,
    win_probability: marketImpliedP,
    odds: 2.0,
    confidence: 0.5,
    bankroll_usd: opts.bankrollUsd,
    max_order_usd: opts.maxOrderUsd,
    max_drawdown_usd: opts.maxDrawdownUsd,
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * UN cycle de pipeline complet. Renvoie un résumé et journalise dans le ledger
 * chaque étape significative (signal, sanitisation, décision, exécution).
 */
export async function runReferenceCycle(
  cycle: number,
  opts: ReferenceLoopOptions,
): Promise<CycleResult> {
  const ledger = opts.ledger;

  // --- étape 2 : sanitizer sur toute entrée textuelle externe ---
  let threatSummary: { source: string; threats: number; modified: boolean } | null = null;
  if (opts.externalText != null) {
    const result = sanitizeInput(opts.externalText);
    threatSummary = {
      source: 'external_text',
      threats: result.threats.length,
      modified: result.modified,
    };
    if (result.threats.length > 0) {
      ledger.append({
        event: 'threat_detected',
        timestamp: new Date().toISOString(),
        payload: { source: 'external_text', threats: result.threats },
      });
    }
  }
  ledger.append({
    event: 'external_text_sanitized',
    timestamp: new Date().toISOString(),
    payload: threatSummary ?? { source: 'none', threats: 0, modified: false },
  });

  // --- étape 1 : signal de la stratégie de référence ---
  const indicatorStart = Date.now();
  const signal = await opts.strategy.evaluate(opts.client);
  const indicatorMs = Date.now() - indicatorStart;
  ledger.append({
    event: signal ? 'signal' : 'no_signal',
    timestamp: new Date().toISOString(),
    payload: signal ? { ...signal, indicator_ms: indicatorMs } : { cycle, indicator_ms: indicatorMs },
  });

  if (!signal) {
    return { cycle, signal, allowed: false, rejected_by: [], execution: 'not_attempted', ledgerRecords: ledger.length };
  }

  const trade = buildReferenceTradeRequest(signal, opts);
  const store = new DurableStateStore(opts.statePath);

  // --- étape 2.5 (PALLAS-M14) : réconciliation du scope AVANT la décision ---
  // Si l'échange dispose d'identifiants L2 (maker), on interroge la réalité
  // AVANT de statuer : tout AMBIGUOUS/SUBMITTING/SUBMMITTED du marché est
  // convergé vers son sort réel. Échec réseau ⇒ on laisse le gate de scope
  // (en dessous) faire barrage : jamais d'émission sur un marché non réglé.
  let reconcileSummary: { results: number; clear: boolean; skipped: boolean } = {
    results: 0,
    clear: true,
    skipped: true,
  };
  if (opts.signer) {
    const ctx: ReconcileContext = { store, client: opts.client, maker: opts.signer.address };
    try {
      const scope = await reconcileScopeForMarket(ctx, trade.market_id);
      reconcileSummary = { results: scope.results.length, clear: scope.clear, skipped: false };
    } catch (err) {
      reconcileSummary = { ...reconcileSummary, skipped: false, clear: false };
      ledger.append({
        event: 'reconcile_scope_error',
        timestamp: new Date().toISOString(),
        payload: {
          market_id: trade.market_id,
          error: err instanceof Error ? err.message.slice(0, 300) : String(err),
        },
      });
    }
  }
  ledger.append({
    event: 'reconcile_scope',
    timestamp: new Date().toISOString(),
    payload: { market_id: trade.market_id, ...reconcileSummary },
  });

  // --- étape 3 : risk engine + écriture DURABLE de la décision (DECIDED) ---
  // Lecture + validation + persist DECIDED sous UN SEUL verrou : personne ne
  // peut écrire entre notre lecture d'état et l'enregistrement de la décision.
  const riskStart = Date.now();
  const outcome = await store.withLock(async (doc) => {
    const { decision, state } = await validateTradeWithState(trade, doc.risk);
    if (!decision.allowed) {
      return { decision, state, lifecycle: null as Awaited<ReturnType<typeof newLifecycle>> | null };
    }
    // --- Gate de scope (PALLAS-M14) : AUCUNE émission tant que le marché porte
    // une empreinte vivante non réglée (AMBIGUOUS/SUBMITTING/RECONCILING/ACKED
    // sans terminal). Le gate est VÉRIFIÉ SOUS LE VERROU : l'état lu est la
    // vérité au moment d'écrire DECIDED.
    const blockedBy = doc.orders.filter((o) => o.market_id === trade.market_id && isLiveFootprint(o));
    if (blockedBy.length > 0) {
      const blockedDecision = {
        allowed: false,
        gates: [],
        rejected_by: ['SCOPE_RECONCILING'],
        suggested_size_usd: 0,
      };
      return { decision: blockedDecision, state, lifecycle: null };
    }
    // Fenêtre de crash 1 (audit §4.5) : "décision perdue avant persistance".
    // Testé : au redémarrage, AUCUN ordre n'existe pour ce correlationId.
    if (opts.crashAfter === 'before_decided') {
      throw new CrashSimulationError('before_decided');
    }
    const correlationId = store.nextCorrelationId(doc);
    const intent: OrderIntent = {
      market_id: trade.market_id,
      side: 'buy',
      price: trade.price,
      quantity: trade.quantity,
      est_value_usd: trade.est_value_usd,
    };
    const lifecycle = newLifecycle(intent, { correlationId });
    doc.risk = state;
    doc.orders.push(lifecycle);
    store.write(doc); // fsync + rename + verrou : DURABLE avant tout réseau
    return { decision, state, lifecycle };
  });
  const riskMs = Date.now() - riskStart;

  ledger.append({
    event: 'risk_decision',
    timestamp: new Date().toISOString(),
    payload: {
      trade,
      decision: outcome.decision,
      state_after: outcome.state,
      risk_ms: riskMs,
      state_persisted: true,
      correlation_id: outcome.lifecycle?.correlationId ?? null,
    },
  });

  if (!outcome.decision.allowed) {
    return {
      cycle,
      signal,
      allowed: false,
      rejected_by: outcome.decision.rejected_by,
      correlation_id: null,
      lifecycle_status: null,
      execution: 'not_attempted',
      ledgerRecords: ledger.length,
    };
  }

  const lifecycle = outcome.lifecycle!;

  // Fenêtre de crash 2 : "état avancé sans preuve d'ordre" — DECIDED durable
  // mais aucune émission. Au redémarrage : ordre DECIDED/order_id=null, jamais
  // d'état neuf, jamais de ré-émission sans réconciliation (garde M14).
  if (opts.crashAfter === 'decided_written') {
    throw new CrashSimulationError('decided_written');
  }

  // --- transition SUBMITTING DURABLE avant tout appel réseau ---
  await store.withLock((doc) => {
    doc.orders = doc.orders.map((o) =>
      o.correlationId === lifecycle.correlationId ? transitionLifecycle(o, { status: 'SUBMITTING' }) : o,
    );
    store.write(doc);
  });

  // Fenêtre de crash 3 : "ordre potentiellement réel sans trace locale".
  // Au redémarrage : SUBMITTING, order_id=null → réconciliation REQUISE.
  if (opts.crashAfter === 'submitting_written') {
    throw new CrashSimulationError('submitting_written');
  }

  // --- étape 4 : exécution (dry-run strict) ---
  const execution = await attemptPlaceOrder(opts, signal, trade, lifecycle, ledger, store);
  return {
    cycle,
    signal,
    allowed: true,
    rejected_by: [],
    correlation_id: lifecycle.correlationId,
    lifecycle_status: latestStatus(store, lifecycle.correlationId),
    execution,
    ledgerRecords: ledger.length,
  };
}

/** Statut courant du lifecycle (lecture fraîche du disque, fail-stop). */
function latestStatus(store: DurableStateStore, correlationId: string): string {
  const doc = store.read();
  return doc.orders.find((o) => o.correlationId === correlationId)?.status ?? 'UNKNOWN';
}

/** Un SEUL appel à placeOrder, jamais de retry (mission §8 : respect strict). */
async function attemptPlaceOrder(
  opts: ReferenceLoopOptions,
  signal: ReferenceSignal,
  trade: TradeRequest,
  lifecycle: { correlationId: string },
  ledger: FileLedger,
  store: DurableStateStore,
): Promise<CycleResult['execution']> {
  const signer = opts.signer ?? ephemeralSigner();
  try {
    const signed = buildSignedOrderPayload(
      { tokenId: BigInt(signal.tokenId), side: signal.side, price: signal.price, size: signal.size },
      signer.address,
      signer.privKey,
    );
    const params: OrderParams = {
      marketId: signal.tokenId,
      price: signal.price,
      size: signal.size,
      side: signal.side,
      tokenId: signal.tokenId,
    };
    const res = await opts.client.placeOrder(params, signed);
    await store.withLock((doc) => {
      doc.orders = doc.orders.map((o) =>
        o.correlationId === lifecycle.correlationId
          ? transitionLifecycle(o, { status: 'ACKED', order_id: res.orderId, outcome: 'acked' })
          : o,
      );
      store.write(doc);
    });
    // Fenêtre de crash 4 : ordre réel reconnu (ACKED durable) mais trace ledger
    // pas encore écrite. Au redémarrage : ACKED + order_id → réconciliation
    // possible (M14) ; jamais de ré-émission sur le même correlationId.
    if (opts.crashAfter === 'acked_written') {
      throw new CrashSimulationError('acked_written');
    }
    ledger.append({
      event: 'execution_success',
      timestamp: new Date().toISOString(),
      payload: { dryRun: res.dryRun, orderId: res.orderId, correlation_id: lifecycle.correlationId },
    });
    return 'execution_success';
  } catch (err) {
    // Une simulation de crash ne doit JAMAIS être absorbée comme erreur d'exécution.
    if (err instanceof CrashSimulationError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('blocked in dry-run')) {
      // L'ordre n'a JAMAIS atteint le réseau (blocage dans placeOrder, avant
      // fetch) : on revient à un état véridique — DECIDED, outcome expliqué.
      await store.withLock((doc) => {
        doc.orders = doc.orders.map((o) =>
          o.correlationId === lifecycle.correlationId
            ? transitionLifecycle(o, { status: 'DECIDED', outcome: 'dry_run_blocked' })
            : o,
        );
        store.write(doc);
      });
      ledger.append({
        event: 'execution_dry_run_blocked',
        timestamp: new Date().toISOString(),
        payload: {
          blocked_by: 'polymarketClient.placeOrder',
          expects: 'dry-run',
          correlation_id: lifecycle.correlationId,
        },
      });
      return 'dry_run_blocked';
    }
    if (err instanceof AmbiguousOrderError) {
      // Réseau contacté, résultat inconnu : état AMBIGUOUS, réconciliation
      // requise (M14) avant toute nouvelle émission sur ce scope.
      await store.withLock((doc) => {
        doc.orders = doc.orders.map((o) =>
          o.correlationId === lifecycle.correlationId
            ? transitionLifecycle(o, { status: 'AMBIGUOUS', outcome: 'pending_reconciliation' })
            : o,
        );
        store.write(doc);
      });
      // PALLAS-M14 : réconciliation IMMÉDIATE dès qu'un résultat ambigu est
      // constaté (mission §3 : "systématiquement après un AmbiguousOrderError").
      // Si elle échoue (réseau toujours cassé), le statut reste AMBIGUOUS et le
      // gate de scope bloque toute nouvelle émission sur ce marché.
      if (opts.signer) {
        try {
          const resolved = await reconcileOrder(
            { store, client: opts.client, maker: opts.signer.address },
            lifecycle.correlationId,
          );
          if (resolved) {
            ledger.append({
              event: 'order_reconciled_on_ambiguity',
              timestamp: new Date().toISOString(),
              payload: { ...resolved },
            });
          }
        } catch (reconcileErr) {
          ledger.append({
            event: 'reconcile_after_ambiguity_error',
            timestamp: new Date().toISOString(),
            payload: {
              correlation_id: lifecycle.correlationId,
              error: reconcileErr instanceof Error ? reconcileErr.message.slice(0, 300) : String(reconcileErr),
            },
          });
        }
      }
    } else {
      await store.withLock((doc) => {
        doc.orders = doc.orders.map((o) =>
          o.correlationId === lifecycle.correlationId
            ? transitionLifecycle(o, { status: 'DECIDED', outcome: 'execution_error' })
            : o,
        );
        store.write(doc);
      });
    }
    ledger.append({
      event: 'execution_error',
      timestamp: new Date().toISOString(),
      payload: { error: message.slice(0, 500), correlation_id: lifecycle.correlationId },
    });
    return 'execution_error';
  }
}

function ephemeralSigner(): { address: string; privKey: Uint8Array } {
  const privKey = secp256k1.utils.randomPrivateKey();
  return { address: privateKeyToAddress(privKey), privKey };
}

/** Point d'entrée : boucle de N cycles sur le client réel (dry-run). */
async function main(): Promise<void> {
  const tokenIds = (process.env.PALLAS_REF_TOKEN_ID ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (tokenIds.length === 0) {
    console.error('PALLAS_REF_TOKEN_ID requis (virgules ok). Ex: PALLAS_REF_TOKEN_ID=<tokenYes>');
    process.exitCode = 1;
    return;
  }
  const cycles = Math.max(1, Number(process.env.PALLAS_REF_CYCLES ?? '3') || 3);
  const threshold = Number(process.env.PALLAS_REF_THRESHOLD ?? '0.6');
  const size = Number(process.env.PALLAS_REF_SIZE ?? '1');
  const bankroll = Number(process.env.PALLAS_REF_BANKROLL_USD ?? '1000');
  const maxOrder = Number(process.env.PALLAS_REF_MAX_ORDER_USD ?? '25');
  const maxDrawdown = Number(process.env.PALLAS_REF_MAX_DRAWDOWN_USD ?? String(Math.round(bankroll * 0.3)));
  const pkHex = process.env.PALLAS_REF_PK ?? '';

  const externalText = process.env.PALLAS_REF_EXTERNAL_TEXT ?? null;
  const statePath = '.pallas/risk-state.json';
  const ledgerPath = '.pallas/ledger.json';
  mkdirSync('.pallas', { recursive: true });

  const client = new PolymarketClient();
  const strategy = new ReferenceStrategy({ tokenIds, buyThreshold: threshold, size });
  const ledger = FileLedger.load(ledgerPath);
  const store = new DurableStateStore(statePath);
  const signer =
    pkHex.length > 0
      ? {
          address: privateKeyToAddress(pkHex),
          privKey: pkHex,
        }
      : undefined;

  // PALLAS-M14 : la vérité du kill switch vit dans l'état durable. Au démarrage
  // on la synchronise AU point d'émission (defense en profondeur) et, si elle
  // passe de false→true, on ordonne un cancel-all à l'exchange (primitive de
  // sortie). En dry-run sans creds, cancel-all est bloqué et simplement loggé.
  const killStart = Date.now();
  try {
    const record = await enforceKillSwitch(store, client);
    ledger.append({
      event: 'kill_switch_sync',
      timestamp: new Date().toISOString(),
      payload: { ...record, elapsed_ms: Date.now() - killStart },
    });
  } catch (err) {
    ledger.append({
      event: 'kill_switch_sync',
      timestamp: new Date().toISOString(),
      payload: {
        engaged: store.read().risk.kill_switch_engaged,
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
        elapsed_ms: Date.now() - killStart,
      },
    });
  }

  console.log(
    JSON.stringify({
      event: 'run_start',
      cycles,
      token_ids: tokenIds,
      threshold,
      size,
      bankroll_usd: bankroll,
      max_order_usd: maxOrder,
      max_drawdown_usd: maxDrawdown,
      signer: signer ? signer.address : 'ephemeral(forme)',
    }),
  );

  for (let c = 1; c <= cycles; c += 1) {
    ledger.append({ event: 'cycle_start', timestamp: new Date().toISOString(), payload: { cycle: c } });
    const result = await runReferenceCycle(c, {
      client,
      strategy,
      ledger,
      statePath,
      bankrollUsd: bankroll,
      maxOrderUsd: maxOrder,
      maxDrawdownUsd: maxDrawdown,
      signer,
      externalText,
    });
    console.log(JSON.stringify(result));
  }

  const diskLedger = FileLedger.load(ledgerPath);
  const verdict = diskLedger.verify();
  const durableCheck = store.read().version;
  console.log(
    JSON.stringify({
      event: 'run_end',
      ledger_entries: diskLedger.length,
      ledger_verify: verdict,
      state_version: durableCheck,
    }),
  );
}

/** Entrée script uniquement — l'import en test ne doit PAS déclencher main(). */
function isEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  const current = import.meta.url;
  const invoked = pathToFileURL(resolve(process.argv[1])).href;
  return current === invoked || basename(invoked).startsWith(basename(fileURLToPath(current)));
}

if (isEntryPoint()) {
  main().catch((err) => {
    console.error(`run-reference-loop: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}