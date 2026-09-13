/**
 * PALLAS-M14 — Réconciliation des ordres avec l'exchange (CLOB Polymarket).
 *
 * Après un `AmbiguousOrderError` (timeout/5xx sur le POST : résultat
 * INDÉTERMINÉ) ou un arrêt entre SUBMITTING et ack (fenêtres M13 B/C/D), l'état
 * local ne suffit plus : il faut demander à l'exchange ce qu'il PENSE de nos
 * ordres avant toute nouvelle émission sur le même marché.
 *
 * Conventions d'état (machine M13) :
 *  - SUBMITTING / SUBMITTED / AMBIGUOUS / RECONCILING ⇒ "footprint vivante
 *    inconnue" : LA réconciliation les résout ;
 *  - ACKED sans terminal_reason ⇒ ordre CONFIRMÉ vivant chez l'exchange : il
 *    bloque le scope (pas de ré-émission tant qu'il n'est pas rempli/annulé) ;
 *  - DECIDED avec un outcome (dry_run_blocked, execution_error…) ⇒ n'a JAMAIS
 *    atteint le réseau : ne bloque pas ;
 *  - DECIDED sans outcome ⇒ un autre processus est en train d'émettre : bloque.
 *
 * Règles strictes : jamais de nouvelle émission sur un scope non réconcilié ;
 * convergence vers l'état réel constaté (ouvert/rempli/annulé/inexistant) sans
 * double émission ; cancellation est TOUJOURS possible (primitive de sécurité).
 */

import { randomUUID } from 'node:crypto';

import type { PolymarketClient, ReadOrder, ReadTrade } from '@pallas/execution';
import { setGlobalKillSwitch } from '@pallas/execution';

import { newLifecycle, transitionLifecycle, type DurableStateStore, type OrderLifecycle } from './durable-state.js';

/** Statuts d'ordre avec une empreinte potentiellement vivante chez l'exchange. */
const UNRESOLVED_LIVE = new Set(['SUBMITTING', 'SUBMITTED', 'AMBIGUOUS', 'RECONCILING'] as const);

export type Convergence = 'ACKED' | 'TERMINAL' | 'UNCHANGED';

export interface ReconciliationResult {
  correlationId: string;
  marketId: string;
  convergence: Convergence;
  orderId: string | null;
  status: string;
  detail: string;
}

export interface ReconcileContext {
  store: DurableStateStore;
  client: PolymarketClient;
  /** Adresse du maker (lecture authentifiée L2 des ordres). */
  maker: string;
}

const SIDE_TO_CLOB: Record<string, string> = { buy: 'BUY', sell: 'SELL' };

/**
 * PALLAS-M22 — âge minimal d'un ordre avant de pouvoir conclure « annulé »
 * par ABSENCE (ni ordre ouvert, ni fill). La disparition des ordres ouverts
 * n'est PAS une preuve : un ordre totalement rempli disparaît aussi. Conclure
 * trop tôt risquerait de libérer le scope et de doubler une position. On exige
 * donc que la fenêtre d'observation [created_at, now] soit significative — sauf
 * si l'exchange a explicitement répondu 404 sur l'order_id (id inconnu = ordre
 * jamais accepté), qui est une preuve positive d'inexistence.
 */
export const MIN_ABSENT_CANCEL_AGE_MS = 60_000;

/** Marge avant `created_at` dans la fenêtre de recherche des trades (horloges). */
const TRADE_WINDOW_SLACK_S = 300;

function orderAgeMs(order: OrderLifecycle): number {
  const t = Date.parse(order.created_at);
  return Number.isFinite(t) ? Date.now() - t : 0; // non datable => fenêtre NON écoulée (fail-safe)
}

function tradeWindowAfter(order: OrderLifecycle): number | undefined {
  const t = Date.parse(order.created_at);
  return Number.isFinite(t) ? Math.floor(t / 1000) - TRADE_WINDOW_SLACK_S : undefined;
}

/** Un ordre local a-t-il une empreinte à réconcilier avant ré-émission ? */
export function isUnresolved(order: OrderLifecycle): boolean {
  if (UNRESOLVED_LIVE.has(order.status as (typeof UNRESOLVED_LIVE extends Set<infer T> ? T : never))) return true;
  if (order.status === 'ACKED' && order.terminal_reason == null) return true;
  if (order.status === 'DECIDED' && order.outcome == null) return true;
  return false;
}

/**
 * Un ordre local représente-t-il une empreinte potentiellement VIVANTE chez
 * l'exchange (à ne PAS doubler par une nouvelle émission) ?
 *  - SUBMITTING/SUBMITTED/AMBIGUOUS/RECONCILING : résultat réseau inconnu ;
 *  - ACKED sans terminal_reason : ordre ouvert confirmé ;
 *  - DECIDED sans outcome : un autre processus peut être en train d'émettre.
 * (Un DECIDED avec outcome dry_run_blocked/execution_error n'a jamais atteint
 * le réseau → ne bloque pas.)
 */
export function isLiveFootprint(order: OrderLifecycle): boolean {
  return (
    UNRESOLVED_LIVE.has(order.status as (typeof UNRESOLVED_LIVE extends Set<infer T> ? T : never)) ||
    (order.status === 'ACKED' && order.terminal_reason == null) ||
    (order.status === 'DECIDED' && order.outcome == null)
  );
}

function liveStatus(remote: ReadOrder | null): 'open' | 'filled' | 'canceled' | 'rejected' | 'unknown' {
  if (!remote) return 'unknown';
  const s = (remote.status ?? '').toLowerCase();
  if (s === 'filled' || s === 'done') return 'filled';
  if (s === 'canceled' || s === 'cancelled') return 'canceled';
  if (s === 'rejected') return 'rejected';
  if (s === 'open' || s === 'live' || s === 'delayed' || s === 'unmatched' || s === 'matched') return 'open';
  return 'unknown';
}

/**
 * Match local <-> ORDRE OUVERT : même actif, même côté, prix ~. La taille lue
 * est la taille RESTANTE (`<= quantity`) : un ordre partiellement rempli reste
 * un ordre ouvert pour le même ordre local, il ne doit donc pas être écarté
 * sur une égalité de taille stricte (PALLAS-M22 — corrige un faux négatif).
 */
function matchesOpen(order: OrderLifecycle, remote: ReadOrder): boolean {
  if (remote.assetId !== order.market_id) return false;
  if ((remote.side ?? '').toUpperCase() !== SIDE_TO_CLOB[order.side]) return false;
  if (remote.price == null) return false;
  if (Math.abs(remote.price - order.price) > 1e-3) return false;
  if (remote.size != null && remote.size > order.quantity * (1 + 1e-6) + 1e-9) return false;
  return true;
}

/**
 * Match local <-> TRADE (fill) : même actif, même côté, prix ~, taille bornée
 * par la quantité demandée. C'est la preuve POSITIVE d'exécution (PALLAS-M22).
 */
function matchesTrade(order: OrderLifecycle, trade: ReadTrade): boolean {
  if (trade.assetId !== order.market_id) return false;
  if ((trade.side ?? '').toUpperCase() !== SIDE_TO_CLOB[order.side]) return false;
  if (trade.price == null || trade.size == null) return false;
  if (trade.size <= 0) return false;
  if (Math.abs(trade.price - order.price) > 1e-3) return false;
  if (trade.size > order.quantity * (1 + 1e-6) + 1e-9) return false;
  return true;
}

/**
 * Réconcilie UN ordre local non réglé : interroge l'exchange (par order_id si
 * connu, sinon par scan des ordres ouverts) et converge l'état vers la réalité.
 *
 * Séquençage respectant l'invariant M13 (transition durable AVANT tout réseau) :
 *   1. transition durable → RECONCILING (sous verrou, écriture fsync) ;
 *   2. lecteur réseau HORS verrou (getOrder/getOpenOrders) ;
 *   3. convergence durable (ACKED/TERMINAL) sous verrou — écritures idempotentes.
 */
export async function reconcileOrder(
  ctx: ReconcileContext,
  correlationId: string,
): Promise<ReconciliationResult | null> {
  const { store, client, maker } = ctx;

  // (1) État "en cours de réconciliation" DURABLE avant tout appel réseau.
  const pre = await store.withLock((doc) => {
    const target = doc.orders.find((o) => o.correlationId === correlationId);
    if (!target) return null;
    if (!isUnresolved(target)) {
      return { order: target, changed: false };
    }
    if (target.status !== 'RECONCILING') {
      doc.orders = doc.orders.map((o) =>
        o.correlationId === correlationId
          ? transitionLifecycle(o, { status: 'RECONCILING', outcome: 'pending_reconciliation' })
          : o,
      );
      store.write(doc); // durable AVANT de parler au réseau
    }
    return { order: doc.orders.find((o) => o.correlationId === correlationId)!, changed: true };
  });
  if (!pre) return null;
  const order = pre.order;
  if (!pre.changed && !isUnresolved(order)) {
    return {
      correlationId,
      marketId: order.market_id,
      convergence: 'UNCHANGED',
      orderId: order.order_id ?? null,
      status: order.status,
      detail: `deja resolu (${order.status})`,
    };
  }

  // (2) Preuve réseau (lecture seule, jamais d'écriture).
  const evidence = await gatherEvidence(client, maker, order);

  // (3) Convergence idempotente sous verrou.
  return store.withLock((doc2) => {
    const target = doc2.orders.find((o) => o.correlationId === correlationId);
    if (!target) return null;
    const patch = evidenceToPatch(evidence, target);
    if (patch == null) {
      // Toujours pas conclu : le passage en RECONCILING (déjà durable) reste,
      // aucune conclusion forcée — le gate de scope continue de faire barrage.
      return {
        correlationId,
        marketId: target.market_id,
        convergence: 'UNCHANGED',
        orderId: target.order_id ?? null,
        status: target.status,
        detail: 'convergence impossible — etat inchange (reconciliation en cours)',
      };
    }
    const updated = transitionLifecycle(target, patch);
    doc2.orders = doc2.orders.map((o) => (o.correlationId === correlationId ? updated : o));
    store.write(doc2);
    return {
      correlationId,
      marketId: target.market_id,
      convergence: updated.status === 'ACKED' ? 'ACKED' : 'TERMINAL',
      orderId: updated.order_id ?? null,
      status: updated.status,
      detail: `${evidenceSummary(evidence)} (etat reel: ${updated.status})`,
    };
  });
}

/**
 * PALLAS-M22 — corpus de preuves réunies auprès de l'exchange.
 *
 * La distinction essentielle : « introuvable dans les ordres ouverts » n'est
 * PAS « inexistant ». Un ordre totalement rempli quitte les ordres ouverts ;
 * seule la lecture de l'historique des trades (`/data/trades`) fournit la
 * preuve positive d'exécution. On collecte donc trois sources indépendantes, et
 * on mémorise lesquelles ont RÉELLEMENT répondu (une erreur réseau interdit
 * toute conclusion par absence).
 */
interface Evidence {
  /** Ordre lu directement par `getOrder(order_id)` (couvre filled/cancelled). */
  direct?: ReadOrder;
  /** `getOrder` a explicitement répondu 404 : id inconnu de l'exchange. */
  directMissing?: boolean;
  /** Le scan des ordres ouverts a abouti (réponse HTTP valide). */
  openScanOk: boolean;
  openMatch?: ReadOrder;
  /** Le scan des trades/fills a abouti (réponse HTTP valide). */
  tradesScanOk: boolean;
  tradeCount: number;
  filledQuantity: number;
  errors: string[];
}

async function gatherEvidence(client: PolymarketClient, maker: string, order: OrderLifecycle): Promise<Evidence> {
  const ev: Evidence = { openScanOk: false, tradesScanOk: false, tradeCount: 0, filledQuantity: 0, errors: [] };

  // (0) Preuve directe par order_id — l'exchange couvre explicitement les
  // ordres annulés ET totalement remplis (docs `/data/order`).
  if (order.order_id != null && order.order_id !== '') {
    try {
      ev.direct = await client.getOrder(order.order_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ev.errors.push(`getOrder: ${msg}`);
      if (/\b404\b/.test(msg)) ev.directMissing = true;
    }
  }

  // (1) Scan des ordres OUVERTS (ordre vivant).
  try {
    const open = await client.getOpenOrders(maker, { filterState: 'open' });
    ev.openScanOk = true;
    ev.openMatch = open.find((remote) => matchesOpen(order, remote));
  } catch (err) {
    ev.errors.push(`getOpenOrders: ${err instanceof Error ? err.message : String(err)}`);
  }

  // (2) Historique des TRADES/FILLS — la preuve positive qui manquait.
  try {
    const trades = await client.getTrades(maker, { assetId: order.market_id, after: tradeWindowAfter(order) });
    ev.tradesScanOk = true;
    const matched = trades.filter((t) => matchesTrade(order, t));
    ev.tradeCount = matched.length;
    ev.filledQuantity = matched.reduce((sum, t) => sum + (t.size ?? 0), 0);
  } catch (err) {
    ev.errors.push(`getTrades: ${err instanceof Error ? err.message : String(err)}`);
  }

  return ev;
}

function evidenceSummary(ev: Evidence): string {
  const direct = ev.direct
    ? `direct=${ev.direct.status ?? 'sans_statut'}`
    : ev.directMissing
      ? 'direct=404'
      : 'direct=non_tente';
  const open = ev.openMatch ? 'ouvert=trouve' : ev.openScanOk ? 'ouvert=aucun' : 'ouvert=erreur';
  const trades = ev.tradesScanOk ? `trades=${ev.tradeCount} fill(s)/${ev.filledQuantity}` : 'trades=erreur';
  return `${direct}, ${open}, ${trades}`;
}

type Patch = { status: 'ACKED' | 'TERMINAL'; terminal_reason?: string; order_id?: string | null; outcome?: string };

/**
 * PALLAS-M22 — convergence à TROIS issues, jamais deux :
 *   1. preuve positive (ordre ouvert, ou fill) → ACKED / TERMINAL filled ;
 *   2. absence CONFIRMÉE par les DEUX sources (ordres ouverts ET trades) sur une
 *      fenêtre significative → TERMINAL cancelled (seule condition légitime) ;
 *   3. impossible à déterminer (une source en erreur, ou fenêtre trop courte)
 *      → `null` : l'ordre RESTE RECONCILING, le gate de scope continue de
 *      barrer (mieux vaut bloquer trop longtemps que doubler une position).
 */
function evidenceToPatch(evidence: Evidence, target: OrderLifecycle): Patch | null {
  // (1) Réponse directe par order_id.
  if (evidence.direct) {
    const kind = liveStatus(evidence.direct);
    if (kind === 'open') {
      return { status: 'ACKED', order_id: evidence.direct.orderId, outcome: 'reconciled_open' };
    }
    if (kind === 'filled') {
      return { status: 'TERMINAL', terminal_reason: 'filled', order_id: evidence.direct.orderId, outcome: 'reconciled_filled' };
    }
    if (kind === 'rejected') {
      return { status: 'TERMINAL', terminal_reason: 'rejected', order_id: evidence.direct.orderId, outcome: 'reconciled_rejected' };
    }
    if (kind === 'canceled') {
      // Annulation CONFIRMÉE par l'exchange. Si des fills existent, une position
      // réelle subsiste : on la classe 'filled' (elle DOIT compter dans
      // l'exposition), jamais 'cancelled' qui l'effacerait.
      if (evidence.filledQuantity > 0) {
        return { status: 'TERMINAL', terminal_reason: 'filled', order_id: evidence.direct.orderId, outcome: 'reconciled_filled_then_cancelled' };
      }
      return { status: 'TERMINAL', terminal_reason: 'cancelled', order_id: evidence.direct.orderId, outcome: 'reconciled_cancelled' };
    }
    // Statut non cartographié : on poursuit vers les scans (pas de conclusion).
  }

  // (2) Ordre OUVERT confirmé par le scan : empreinte vivante, bloque le scope.
  if (evidence.openMatch) {
    return { status: 'ACKED', order_id: evidence.openMatch.orderId, outcome: 'reconciled_open' };
  }

  // (3) Preuve POSITIVE d'exécution par les trades — le cas que M14 ratait.
  if (evidence.filledQuantity > 0) {
    const tol = 1e-6 * Math.max(1, target.quantity) + 1e-9;
    if (evidence.filledQuantity + tol >= target.quantity) {
      return { status: 'TERMINAL', terminal_reason: 'filled', outcome: 'reconciled_filled_by_trade' };
    }
    // Remplissage PARTIEL : l'ordre reste vivant (reste à exécuter) → ACKED,
    // le scope reste bloqué. Jamais 'cancelled', jamais 'filled' complet.
    return { status: 'ACKED', outcome: 'reconciled_partial_fill' };
  }

  // (4) AUCUNE preuve positive. 'cancelled' exige que les DEUX sources aient
  // RÉPONDU sans erreur ET que l'absence soit concluante.
  if (evidence.openScanOk && evidence.tradesScanOk) {
    const conclusive = evidence.directMissing === true || orderAgeMs(target) >= MIN_ABSENT_CANCEL_AGE_MS;
    if (!conclusive) return null; // fenêtre trop courte -> reste RECONCILING
    return { status: 'TERMINAL', terminal_reason: 'cancelled', outcome: 'not_found_on_exchange' };
  }

  // (5) Au moins une source n'a pas répondu : AUCUNE conclusion.
  return null;
}

/**
 * Réconcilie TOUS les ordres non réglés d'un marché donné (scope).
 * Retourne les résultats + `clear` = scope n'a plus d'empreinte vivante.
 */
export async function reconcileScopeForMarket(
  ctx: ReconcileContext,
  marketId: string,
): Promise<{ results: ReconciliationResult[]; clear: boolean }> {
  const doc = ctx.store.read();
  const unresolved = doc.orders.filter((o) => o.market_id === marketId && isUnresolved(o));
  const results: ReconciliationResult[] = [];
  for (const order of unresolved) {
    const res = await reconcileOrder(ctx, order.correlationId);
    if (res) results.push(res);
  }
  const after = ctx.store.read();
  const remaining = after.orders.filter((o) => o.market_id === marketId && isUnresolved(o));
  return { results, clear: remaining.length === 0 };
}

/** Un scope (marché) a-t-il encore une empreinte vivante bloquant l'émission ? */
export function scopeHasLiveFootprint(store: DurableStateStore, marketId: string): boolean {
  const doc = store.read();
  return doc.orders.some((o) => o.market_id === marketId && isLiveFootprint(o));
}

/**
 * Réconciliation au démarrage : traite tous les ordres locaux non réglés, puis
 * recense les ordres OUVERTS de l'exchange absents de l'état local (ordres
 * "externes") pour que l'exposition réelle (M15) en tienne compte.
 */
export async function reconcileAtStartup(
  ctx: ReconcileContext,
): Promise<{ results: ReconciliationResult[]; externalOrders: string[]; openOrders: ReadOrder[] }> {
  const client = ctx.client;
  const maker = ctx.maker;
  const initial = ctx.store.read();
  const results: ReconciliationResult[] = [];
  for (const order of initial.orders.filter((o) => isUnresolved(o))) {
    const res = await reconcileOrder(ctx, order.correlationId);
    if (res) results.push(res);
  }

  // Ordres ouverts de l'exchange absents de l'état local : enregistrés comme
  // ACKED "externes" (aucune décision inventée, ils restent visibles).
  let open: ReadOrder[] = [];
  try {
    open = await client.getOpenOrders(maker, { filterState: 'open' });
  } catch {
    open = [];
  }
  const doc = ctx.store.read();
  const knownAssets = new Set(doc.orders.filter((o) => isLiveFootprint(o)).map((o) => o.market_id));
  const externalAssets = new Set(open.filter((o) => !knownAssets.has(o.assetId)).map((o) => o.assetId));
  if (externalAssets.size > 0) {
    await ctx.store.withLock((doc2) => {
      const existing = new Set(doc2.orders.map((o) => o.order_id).filter((id): id is string => id != null));
      for (const remote of open) {
        if (!externalAssets.has(remote.assetId)) continue;
        if (remote.orderId && existing.has(remote.orderId)) continue;
        if (remote.side == null || remote.price == null || remote.size == null) continue;
        const lifecycle = transitionLifecycle(
          newLifecycle(
            {
              market_id: remote.assetId,
              side: remote.side.toLowerCase() === 'sell' ? 'sell' : 'buy',
              price: remote.price,
              quantity: remote.size,
              est_value_usd: Math.round(remote.price * remote.size * 100) / 100,
            },
            { correlationId: randomUUID() },
          ),
          {
            status: 'ACKED',
            order_id: remote.orderId,
            outcome: 'external_found_at_startup',
          },
        );
        doc2.orders.push(lifecycle);
      }
      ctx.store.write(doc2);
    });
  }
  return { results, externalOrders: [...externalAssets], openOrders: open };
}

/**
 * Activation du kill switch (PALLAS-M14) : engage le flag global d'émission ET,
 * sur transition false→true, déclenche un `cancelAllOrders()` RÉEL (pas
 * seulement un blocage des futures décisions). Idempotent via meta.
 */
export async function enforceKillSwitch(
  store: DurableStateStore,
  client: PolymarketClient,
): Promise<{ engaged: boolean; cancelAll: 'not_needed' | 'called' | 'dry_run_blocked' | 'error'; detail: string }> {
  const doc = store.read();
  const engaged = doc.risk.kill_switch_engaged;
  setGlobalKillSwitch(engaged);
  if (!engaged) {
    return { engaged, cancelAll: 'not_needed', detail: 'kill switch not engaged' };
  }
  const meta = (doc.meta ?? {}) as Record<string, unknown>;
  if (meta['kill_switch_cancelall_called'] === true) {
    return { engaged, cancelAll: 'not_needed', detail: 'cancel-all already issued for this engagement' };
  }
  try {
    const res = await client.cancelAllOrders();
    const called = res.cancelled;
    await store.withLock((doc2) => {
      const m = (doc2.meta ?? {}) as Record<string, unknown>;
      doc2.meta = { ...m, kill_switch_cancelall_called: true };
      store.write(doc2);
    });
    return { engaged, cancelAll: called ? 'called' : 'dry_run_blocked', detail: 'cancel-all issued at emission gate' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isDry = message.includes('blocked in dry-run');
    return { engaged, cancelAll: isDry ? 'dry_run_blocked' : 'error', detail: message.slice(0, 300) };
  }
}