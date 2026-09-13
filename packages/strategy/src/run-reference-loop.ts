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

import { mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { secp256k1 } from '@noble/curves/secp256k1.js';

import { sanitizeInput, emitAnomaly } from '@pallas/core';
import { validateTradeWithState, type RiskConfig, type TradeRequest } from '@pallas/risk';
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
  exposureFromOrders,
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
  /**
   * Configuration de risque OPERATEUR (PALLAS-M15). La stratégie n'en fournit
   * AUCUN champ : `bankroll_usd`/`max_order_usd`/`max_drawdown_usd` ont quitté
   * l'appelant et ne peuvent plus être reconstruits par le trade.
   */
  riskConfig: RiskConfig;
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

/**
 * Construit le TradeRequest à partir du signal — INTENTION pure, sans AUCUNE
 * limite (PALLAS-M15) : bankroll_usd/max_order_usd/max_drawdown_usd ne vivent
 * que dans RiskConfig (opérateur). `marketDataAgeMs` est l'âge de l'orderbook
 * au moment de la décision (garde stale-price).
 */
export function buildReferenceTradeRequest(signal: ReferenceSignal, marketDataAgeMs: number): TradeRequest {
  warnKellyIllustrative();
  const estValue = Math.round(signal.price * signal.size * 100) / 100;
  const marketImpliedP = clamp01(signal.price);
  return {
    market_id: signal.tokenId,
    side: 'buy',
    price: signal.price,
    quantity: signal.size,
    est_value_usd: estValue,
    // ⚠  PALLAS-M18 — VALEURS ILLUSTRATIVES, AUCUNE CALIBRATION STATISTIQUE.
    //
    // `win_probability = signal.price` (prix du marché) et `odds = 2.0` (valeur
    // arbitraire) ne produisent PAS une estimation prédictive de la probabilité de
    // gain. Le couple est fixe, constant, et n'est assorti d'aucun backtest,
    // aucune validation out-of-sample, aucun edge estimé.
    //
    // Ces valeurs existent UNIQUEMENT pour faire tourner le pipeline technique
    // (risk engine → Kelly → size suggestion) de bout en bout en dry-run.
    // La stratégie de référence est non-prédictive par conception (docs/STRATEGY.md).
    // Toute tentative de les interpréter comme un signal de trading est une erreur.
    win_probability: marketImpliedP,
    odds: 2.0,
    confidence: 0.5,
    market_data_age_ms: marketDataAgeMs,
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// PALLAS-M18 — avertissement de log émis UNE FOIS à la première construction
// d'un TradeRequest : jamais de calibration statistique derrière les paramètres
// Kelly de la stratégie de référence (voir le commentaire dans
// `buildReferenceTradeRequest`). Visible directement dans les logs du pipeline,
// sans avoir à ouvrir un autre fichier.
let kellyIllustrativeLog = false;
function warnKellyIllustrative(): void {
  if (kellyIllustrativeLog) return;
  kellyIllustrativeLog = true;
  console.warn(
    '[PALLAS-M18] STRATEGIE DE REFERENCE : win_probability=price et odds=2.0 sont des valeurs ' +
      'ILLUSTRATIVES (aucun backtest, aucune calibration statistique). La taille suggeree par le ' +
      "score Kelly ne porte AUCUNE information predictive - ne pas l'interpreter comme un edge.",
  );
}

/**
 * PALLAS-M18 — taille d'ordre EFFECTIVEMENT appliquée.
 *
 * Le risk engine suggère `suggestedSizeUsd` en DOLLARS, le signal porte une
 * taille en PARTS. La propriété exigible est « notional transmis ≤ min(notional
 * demandé, taille autorisée) » : on plafonne donc dans l'espace USD —
 * `appliedNotional = min(price × size, suggestedSizeUsd)`, puis parts =
 * appliedNotional/price. Jamais au-dessus de la taille demandée. Défense en
 * profondeur : même si le gate KELLY_LIMIT (M09) laissait un écart passer,
 * c'est la taille plafonnée qui est construite et signée — pas le signal brut.
 */
export function appliedOrderSize(price: number, size: number, suggestedSizeUsd: number): number {
  if (!(price > 0)) return size;
  const demandNotional = price * size;
  const appliedNotional = Math.min(demandNotional, Math.max(0, suggestedSizeUsd));
  const appliedShares = appliedNotional / price;
  return Math.min(size, appliedShares);
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
      await ledger.append({
        event: 'threat_detected',
        timestamp: new Date().toISOString(),
        payload: { source: 'external_text', threats: result.threats },
      });
    }
  }
  await ledger.append({
    event: 'external_text_sanitized',
    timestamp: new Date().toISOString(),
    payload: threatSummary ?? { source: 'none', threats: 0, modified: false },
  });

  // --- étape 1 : signal de la stratégie de référence ---
  const indicatorStart = Date.now();
  const signal = await opts.strategy.evaluate(opts.client);
  const indicatorMs = Date.now() - indicatorStart;
  await ledger.append({
    event: signal ? 'signal' : 'no_signal',
    timestamp: new Date().toISOString(),
    payload: signal ? { ...signal, indicator_ms: indicatorMs } : { cycle, indicator_ms: indicatorMs },
  });

  if (!signal) {
    return { cycle, signal, allowed: false, rejected_by: [], execution: 'not_attempted', ledgerRecords: ledger.length };
  }

  const trade = buildReferenceTradeRequest(signal, indicatorMs);
  const store = new DurableStateStore(opts.statePath);
  // PALLAS-M23 : rattrapage état<->ledger AVANT toute décision. Un crash
  // entre la transition ACKED durable et son entrée ledger (fenêtre D) laisse
  // un ordre reconnu sans trace d'audit ; on répare ici, de façon idempotente.
  await reconcileStateLedger(store, ledger);

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
      // PALLAS-M20 : une réconciliation qui échoue est une anomalie opérationnelle
      // à alerter (stock AMBIGUOUS non réglé → scope bloqué). Dédupliqué en mémoire.
      emitAnomaly('RECONCILE_FAILED', 'reconcile scope failed', {
        market_id: trade.market_id,
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
      });
      await ledger.append({
        event: 'reconcile_scope_error',
        timestamp: new Date().toISOString(),
        payload: {
          market_id: trade.market_id,
          error: err instanceof Error ? err.message.slice(0, 300) : String(err),
        },
      });
    }
  }

  await ledger.append({
    event: 'reconcile_scope',
    timestamp: new Date().toISOString(),
    payload: { market_id: trade.market_id, ...reconcileSummary },
  });
  // --- étape 3 : risk engine + écriture DURABLE de la décision (DECIDED) ---
  // Lecture + validation + persist DECIDED sous UN SEUL verrou : personne ne
  // peut écrire entre notre lecture d'état et l'enregistrement de la décision.
  // PALLAS-M15 : l'âge des données est mesuré AU moment de la décision (il
  // englobe fetch+signal+réconciliation), et l'exposition réelle est calculée
  // depuis les ordres vivants (positions + ordres ouverts) du document.
  const riskStart = Date.now();
  const dataAgeMs = Date.now() - indicatorStart;
  trade.market_data_age_ms = dataAgeMs;
  const outcome = await store.withLock(async (doc) => {
    const stateInput = { ...doc.risk, exposure: exposureFromOrders(doc.orders) };
    const { decision, state } = await validateTradeWithState(trade, stateInput, opts.riskConfig);
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

  await ledger.append({
    event: 'risk_decision',
    timestamp: new Date().toISOString(),
    payload: {
      trade,
      decision: outcome.decision,
      state_after: outcome.state,
      risk_ms: riskMs,
      started_at: new Date(riskStart).toISOString(),
      finished_at: new Date().toISOString(),
      state_persisted: true,
      correlation_id: outcome.lifecycle?.correlationId ?? null,
      intent_hash: outcome.lifecycle?.intent_hash ?? null,
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

  // PALLAS-M18 : l'orchestrateur APPLIQUE la taille suggérée, il ne la vérifie
  // pas seulement. Le payload signé est construit sur `appliedSize`, jamais sur
  // la taille brute du signal — indépendamment du gate KELLY_LIMIT (M09).
  const appliedSize = appliedOrderSize(trade.price, trade.quantity, outcome.decision.suggested_size_usd);

  // --- étape 4 : exécution (dry-run strict) ---
  const execution = await attemptPlaceOrder(opts, signal, trade, lifecycle, ledger, store, appliedSize);
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

/**
 * PALLAS-M23 — réconciliation de démarrage ÉTAT <-> LEDGER (audit v0.4 F-01).
 *
 * L'état (snapshot checksummé) et le ledger (chaîne append-only) sont DEUX
 * fichiers distincts, écrits séparément : un crash entre la transition durable
 * ACKED et `ledger.append('execution_success')` laisse un ordre réel et
 * reconnu SANS trace d'audit (fenêtre D). Ce rattrapage détecte les ordres ACKED
 * dont le `correlation_id` n'apparaît dans AUCUNE entrée
 * `execution_success` et émet une entrée de réparation — IDEMPOTENTE :
 * une entrée déjà présente n'est jamais dupliquée.
 *
 * Fenêtre résiduelle assumée (documentée) : entre le crash et le prochain
 * démarrage, le ledger ne porte pas encore la trace. L'état, lui, n'est jamais
 * faux (il a été écrit DURABLEMENT avant l'appel réseau), et aucune ré-émission
 * n'est possible sur ce correlationId (empreinte ACKED -> gate de scope M14).
 */
export async function reconcileStateLedger(
  store: DurableStateStore,
  ledger: FileLedger,
): Promise<{ repaired: number; checked: number }> {
  const doc = store.read();
  const acknowledged = doc.orders.filter((o) => o.status === 'ACKED' && o.order_id != null);
  if (acknowledged.length === 0) return { repaired: 0, checked: 0 };
  const traced = new Set(
    ledger.entries
      .filter((e) => e.event === 'execution_success')
      .map((e) => (e.payload as { correlation_id?: string } | undefined)?.correlation_id)
      .filter((id): id is string => typeof id === 'string'),
  );
  let repaired = 0;
  for (const order of acknowledged) {
    if (traced.has(order.correlationId)) continue;
    await ledger.append({
      event: 'execution_success',
      timestamp: new Date().toISOString(),
      payload: {
        recovered_at_restart: true,
        orderId: order.order_id,
        correlation_id: order.correlationId,
        outcome: order.outcome ?? 'acked',
        note: 'PALLAS-M23 — rattrapage: etat ACKED sans entree ledger (crash fenetre D)',
      },
    });
    repaired += 1;
  }
  return { repaired, checked: acknowledged.length };
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
  lifecycle: { correlationId: string; attempt: number },
  ledger: FileLedger,
  store: DurableStateStore,
  appliedSize: number,
): Promise<CycleResult['execution']> {
  const signer = opts.signer ?? ephemeralSigner();
  const execStarted = new Date();
  try {
    // PALLAS-M18 : le payload signé porte `appliedSize`, pas signal.size.
    const signed = buildSignedOrderPayload(
      { tokenId: BigInt(signal.tokenId), side: signal.side, price: signal.price, size: appliedSize },
      signer.address,
      signer.privKey,
    );
    const params: OrderParams = {
      marketId: signal.tokenId,
      price: signal.price,
      size: appliedSize,
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
    await ledger.append({
      event: 'execution_success',
      timestamp: new Date().toISOString(),
      payload: {
        dryRun: res.dryRun,
        orderId: res.orderId,
        http_status: res.httpStatus,
        correlation_id: lifecycle.correlationId,
        attempt: lifecycle.attempt,
        started_at: execStarted.toISOString(),
        finished_at: new Date().toISOString(),
        // PALLAS-M18 : la taille EFFECTIVEMENT transmise et signée (peut être
        // < signal.size si le plafond suggested_size_usd la contraignait).
        applied_size: appliedSize,
        demanded_size: signal.size,
      },
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
      await ledger.append({
        event: 'execution_dry_run_blocked',
        timestamp: new Date().toISOString(),
        payload: {
          blocked_by: 'polymarketClient.placeOrder',
          expects: 'dry-run',
          correlation_id: lifecycle.correlationId,
          attempt: lifecycle.attempt,
          started_at: execStarted.toISOString(),
          finished_at: new Date().toISOString(),
        },
      });
      return 'dry_run_blocked';
    }
    if (err instanceof AmbiguousOrderError) {
      // Réseau contacté, résultat inconnu : état AMBIGUOUS, réconciliation
      // requise (M14) avant toute nouvelle émission sur ce scope.
      // PALLAS-M20 : ordre ambigu = anomalie à alerter immédiatement — la simple
      // ligne de ledger est noyée, l'alerte est observable (JSONL CRITICAL + webhook).
      emitAnomaly('AMBIGUOUS_ORDER', 'order result unknown after network contact', {
        correlation_id: lifecycle.correlationId,
        market_id: signal.tokenId,
        attempt: lifecycle.attempt,
      });
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
              await ledger.append({
                event: 'order_reconciled_on_ambiguity',
                timestamp: new Date().toISOString(),
                payload: { ...resolved },
              });
            }
          } catch (reconcileErr) {
            // PALLAS-M20 : réconciliation d'un ordre ambigu échouée — anomalie.
            emitAnomaly('RECONCILE_FAILED', 'reconcile after ambiguity failed', {
              correlation_id: lifecycle.correlationId,
              error: reconcileErr instanceof Error ? reconcileErr.message.slice(0, 300) : String(reconcileErr),
            });
            await ledger.append({
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
    await ledger.append({
      event: 'execution_error',
      timestamp: new Date().toISOString(),
      payload: {
        error: message.slice(0, 500),
        correlation_id: lifecycle.correlationId,
        attempt: lifecycle.attempt,
        started_at: execStarted.toISOString(),
        finished_at: new Date().toISOString(),
      },
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
  // PALLAS-M15 : la configuration de risque est OPERATEUR, jamais portée par un
  // trade. Valeurs par défaut conservatrices, surchargables par variables.
  const bankroll = Number(process.env.PALLAS_REF_BANKROLL_USD ?? '1000');
  const riskConfig: RiskConfig = {
    bankroll_usd: bankroll,
    max_order_usd: Number(process.env.PALLAS_REF_MAX_ORDER_USD ?? '25'),
    max_portfolio_exposure_usd: Number(process.env.PALLAS_REF_PORTFOLIO_EXPOSURE_USD ?? String(bankroll)),
    max_drawdown_usd: Number(process.env.PALLAS_REF_MAX_DRAWDOWN_USD ?? String(Math.round(bankroll * 0.3))),
    max_concentration_usd: Number(process.env.PALLAS_REF_CONCENTRATION_USD ?? String(bankroll)),
    half_open_probe_size_usd: Number(process.env.PALLAS_REF_HALF_OPEN_PROBE_USD ?? '50'),
    var_min_observations: Number(process.env.PALLAS_REF_VAR_MIN_OBSERVATIONS ?? '20'),
    var_startup_envelope_usd: Number(process.env.PALLAS_REF_VAR_ENVELOPE_USD ?? String(Math.round(bankroll * 0.1))),
    max_market_data_age_ms: Number(process.env.PALLAS_REF_MAX_DATA_AGE_MS ?? '600000'),
  };
  const pkHex = process.env.PALLAS_REF_PK ?? '';

  const externalText = process.env.PALLAS_REF_EXTERNAL_TEXT ?? null;
  const statePath = '.pallas/risk-state.json';
  const ledgerPath = '.pallas/ledger.json';
  mkdirSync('.pallas', { recursive: true });

  // PALLAS-M16 : clé publique de vérification du checkpoint .sig (si fournie,
  // le démarrage EXIGE un ledger signé). Contenu PEM SPKI ou chemin de fichier.
  let ledgerPublicKey: string | undefined;
  const pubKeyEnv = process.env.PALLAS_LEDGER_PUB_KEY ?? '';
  if (pubKeyEnv.length > 0) {
    ledgerPublicKey = pubKeyEnv.includes('-----BEGIN PUBLIC KEY-----')
      ? pubKeyEnv
      : readFileSync(pubKeyEnv, 'utf8').trim();
  }

  const client = new PolymarketClient();
  const strategy = new ReferenceStrategy({ tokenIds, buyThreshold: threshold, size });
  // PALLAS-M20 : un ledger corrompu (rupture/truncation/sig invalide) est un
  // incident — alerte CRITICAL AVANT le fail-stop du chargement.
  let ledger: FileLedger;
  try {
    ledger = FileLedger.load(ledgerPath, { publicKeyPem: ledgerPublicKey });
  } catch (err) {
    emitAnomaly('LEDGER_CORRUPT', 'ledger load fail-stop triggered', {
      path: ledgerPath,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err),
    });
    throw err;
  }
  // PALLAS-M20 : état durable corrompu/cassé (checksum) au démarrage = incident.
  let store: DurableStateStore;
  try {
    store = new DurableStateStore(statePath);
    // PALLAS-M26 : la CONSTRUCTION ne lit rien — c'est la LECTURE qui peut
    // échouer sur corruption. On lit ici pour un fail-stop au démarrage.
    // `read()` émet lui-même STATE_CORRUPT au point de détection réel.
    store.read();
  } catch (err) {
    emitAnomaly('STATE_CORRUPT', 'durable state load fail-stop triggered', {
      path: statePath,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err),
    });
    throw err;
  }
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
    // PALLAS-M20 : kill switch ENGAGÉ = alerte immédiate, pas seulement un
    // warning du dashboard (le cancel-all a été déclenché ou est bloqué).
    if (record.engaged === true) {
      emitAnomaly('KILL_SWITCH', 'global kill switch ENGAGED', { state: 'engaged', cancel_all: record.cancelAll });
    }
    await ledger.append({
      event: 'kill_switch_sync',
      timestamp: new Date().toISOString(),
      payload: { ...record, elapsed_ms: Date.now() - killStart },
    });
  } catch (err) {
    // PALLAS-M26 : si l'erreur EST une corruption d'état, `store.read()`
    // relève StateCorruptionError ; cette seconde lecture ne doit ni masquer
    // l'erreur d'origine ni faire crasher le chemin d'alerte.
    let engaged: boolean | null = null;
    try {
      engaged = store.read().risk.kill_switch_engaged;
    } catch {
      engaged = null;
    }
    await ledger.append({
      event: 'kill_switch_sync',
      timestamp: new Date().toISOString(),
      payload: {
        engaged,
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
      riskConfig,
      ledger: { entries: ledger.length, signed: ledger.isSigned, verified: true },
      signer: signer ? signer.address : 'ephemeral(forme)',
    }),
  );

  for (let c = 1; c <= cycles; c += 1) {
    await ledger.append({ event: 'cycle_start', timestamp: new Date().toISOString(), payload: { cycle: c } });
    const result = await runReferenceCycle(c, {
      client,
      strategy,
      ledger,
      statePath,
      riskConfig,
      signer,
      externalText,
    });
    console.log(JSON.stringify(result));
  }

  const diskLedger = FileLedger.load(ledgerPath, { publicKeyPem: ledgerPublicKey });
  const verdict = diskLedger.verify();
  const durableCheck = store.read().version;
  console.log(
    JSON.stringify({
      event: 'run_end',
      ledger_entries: diskLedger.length,
      ledger_signed: diskLedger.isSigned,
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