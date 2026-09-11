/**
 * Orchestrateur minimal d'intégration bout-en-bout (PALLAS-M12).
 *
 * PAS un serveur, PAS un gateway, PAS une UI : un script/fonction qui boucle
 * sur = un cycle de pipeline complet. Il relie pour la PREMIÈRE fois :
 *
 *   ReferenceStrategy (signal) -> sanitizeInput (texte externe) ->
 *   validateTradeWithState (état persistant fichier JSON) -> placeOrder
 *   (dry-run strict, blocage attendu) -> ledger append-only (chaque étape).
 *
 * Contraintes de la mission (§3, §6, §8) respectées à la lettre :
 *  - Aucune capacité live nouvelle ; le dry-run reste le comportement par
 *    défaut (flag global @pallas/core). placeOrder en dry-run THROW -> on
 *    journalise CE blocage comme résultat attendu, jamais de retry.
 *  - Un rejet du risk engine est RESPECTÉ : pas d'appel à placeOrder, pas de
 *    re-tentative automatique.
 *  - Le payload signé est construit POUR LA FORME (le process signe puis
 *    s'arrête au blocage dry-run) — aucune clé live nécessaire ; une clé
 *    éphémère est générée si PALLAS_REF_PK n'est pas fournie.
 *  - La limite de persistance (fichier JSON local, pas de base de données)
 *    est une décision DÉLIBÉRÉE de la mission (§6.4).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import { sanitizeInput } from '@pallas/core';
import { validateTradeWithState, type StateInput, type TradeRequest } from '@pallas/risk';
import {
  PolymarketClient,
  buildSignedOrderPayload,
  privateKeyToAddress,
  type OrderParams,
} from '@pallas/execution';
import { FileLedger } from '@pallas/ledger';

import { ReferenceStrategy, type ReferenceSignal } from './reference.js';

export interface ReferenceLoopOptions {
  client: PolymarketClient;
  strategy: ReferenceStrategy;
  /** Instance de ledger PARTAGÉE avec l'appelant : une seule écriture du fichier. */
  ledger: FileLedger;
  statePath: string;
  bankrollUsd: number;
  maxOrderUsd: number;
  maxDrawdownUsd: number;
  /** Signataire "de forme" pour le payload signé dry-run (éphémère si omis). */
  signer?: { address: string; privKey: Uint8Array | string };
  /** Texte externe à faire passer par sanitizeInput avant tout traitement. */
  externalText?: string | null;
}

export interface CycleResult {
  cycle: number;
  signal: ReferenceSignal | null;
  allowed: boolean;
  rejected_by: string[];
  execution: 'dry_run_blocked' | 'execution_error' | 'execution_success' | 'not_attempted';
  ledgerRecords: number;
}

/** Construit le TradeRequest à partir du signal — valeurs neutres NON-prédictives. */
export function buildReferenceTradeRequest(
  signal: ReferenceSignal,
  opts: Pick<ReferenceLoopOptions, 'bankrollUsd' | 'maxOrderUsd' | 'maxDrawdownUsd'>,
): TradeRequest {
  const estValue = Math.round(signal.price * signal.size * 100) / 100;
  const marketImpliedP = clamp01(signal.price);
  // Conventions différentes : le moteur de risque attend "buy"/"sell" minuscules,
  // la ReferenceStrategy (et Polymarket) n'émet que BUY en majuscules.
  return {
    market_id: signal.tokenId,
    side: 'buy',
    price: signal.price,
    quantity: signal.size,
    est_value_usd: estValue,
    // AMORCES NEUTRES fixées (mission §1) : AUCUN paramètre optimisé, AUCUNE
    // revendication de probabilité. `win_probability` reprend le PRIX DU MARCHÉ
    // (probabilité implicite, "le marché est supposé correct") — pas un edge.
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

function loadState(path: string): StateInput {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (typeof raw === 'object' && raw !== null) {
      return raw as StateInput;
    }
  } catch {
    /* fichier absent ou corrompu -> état frais */
  }
  return { hist_pnls: [] };
}

function saveState(path: string, state: unknown): void {
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, JSON.stringify(state, null, 2) + '\n', 'utf8');
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

  let allowed = false;
  let rejected_by: string[] = [];
  if (signal) {
    const trade = buildReferenceTradeRequest(signal, opts);

    // --- étape 3 : risk engine avec état persistant entre appels ---
    const stateBefore = loadState(opts.statePath);
    const riskStart = Date.now();
    const { decision, state } = await validateTradeWithState(trade, stateBefore);
    const riskMs = Date.now() - riskStart;
    saveState(opts.statePath, state);
    allowed = decision.allowed;
    rejected_by = decision.rejected_by;

    ledger.append({
      event: 'risk_decision',
      timestamp: new Date().toISOString(),
      payload: {
        trade,
        decision,
        state_after: state,
        risk_ms: riskMs,
        state_persisted: true,
      },
    });

    // --- étape 4 : exécution (dry-run strict) ---
    if (decision.allowed) {
      const execution = await attemptPlaceOrder(opts, signal, trade, ledger);
      return {
        cycle,
        signal,
        allowed,
        rejected_by,
        execution,
        ledgerRecords: ledger.length,
      };
    }
  }

  return { cycle, signal, allowed, rejected_by, execution: 'not_attempted', ledgerRecords: ledger.length };
}

/** Un SEUL appel à placeOrder, jamais de retry (mission §8 : respect strict). */
async function attemptPlaceOrder(
  opts: ReferenceLoopOptions,
  signal: ReferenceSignal,
  trade: TradeRequest,
  ledger: FileLedger,
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
    ledger.append({
      event: 'execution_success',
      timestamp: new Date().toISOString(),
      payload: { dryRun: res.dryRun, orderId: res.orderId },
    });
    return 'execution_success';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('blocked in dry-run')) {
      ledger.append({
        event: 'execution_dry_run_blocked',
        timestamp: new Date().toISOString(),
        payload: { blocked_by: 'polymarketClient.placeOrder', expects: 'dry-run' },
      });
      return 'dry_run_blocked';
    }
    ledger.append({
      event: 'execution_error',
      timestamp: new Date().toISOString(),
      payload: { error: message.slice(0, 500) },
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
  const signer =
    pkHex.length > 0
      ? {
          address: privateKeyToAddress(pkHex),
          privKey: pkHex,
        }
      : undefined;

  console.log(JSON.stringify({ event: 'run_start', cycles, token_ids: tokenIds, threshold, size, bankroll_usd: bankroll, max_order_usd: maxOrder, max_drawdown_usd: maxDrawdown, signer: signer ? signer.address : 'ephemeral(forme)' }));

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

  // Vérification finale sur une RECHARGE fraîche du fichier : la chaîne vérifiée
  // est exactement celle persistée sur disque, pas un snapshot en mémoire.
  const diskLedger = FileLedger.load(ledgerPath);
  const verdict = diskLedger.verify();
  console.log(
    JSON.stringify({
      event: 'run_end',
      ledger_entries: diskLedger.length,
      ledger_verify: verdict,
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