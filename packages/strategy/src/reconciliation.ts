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

import type { PolymarketClient, ReadOrder } from '@pallas/execution';
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

/** Match local <-> carte CLOB : même actif, même côté, prix ~, taille ~. */
function matches(order: OrderLifecycle, remote: ReadOrder): boolean {
  if (remote.assetId !== order.market_id) return false;
  if ((remote.side ?? '').toUpperCase() !== SIDE_TO_CLOB[order.side]) return false;
  if (remote.price == null || remote.size == null) return false;
  const priceOk = Math.abs(remote.price - order.price) <= 1e-3;
  const sizeOk = Math.abs(remote.size - order.quantity) <= 1e-6 * Math.max(1, order.quantity);
  return priceOk && sizeOk;
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
      detail: `${evidence.kind} (etat reel: ${evidence.remoteStatus ?? 'inconnu'})`,
    };
  });
}

interface Evidence {
  kind: 'order_id' | 'open_scan' | 'query_error';
  remote?: ReadOrder;
  remoteStatus?: string;
  orderId?: string;
  error?: string;
}

async function gatherEvidence(client: PolymarketClient, maker: string, order: OrderLifecycle): Promise<Evidence> {
  if (order.order_id != null) {
    try {
      const remote = await client.getOrder(order.order_id);
      return {
        kind: order.order_id !== '' ? 'order_id' : 'open_scan',
        remote,
        remoteStatus: remote.status ?? undefined,
        orderId: remote.orderId,
      };
    } catch {
      // order_id inconnu de l'exchange : traité comme inexistant (convergence
      // vers "annulé"), jamais comme une ré-émission aveugle.
      return { kind: 'order_id', remoteStatus: 'unknown', error: 'getOrder failed or 404' };
    }
  }
  try {
    const open = await client.getOpenOrders(maker, { filterState: 'open' });
    const matched = open.find((remote) => matches(order, remote));
    return {
      kind: 'open_scan',
      remote: matched ?? undefined,
      remoteStatus: matched?.status ?? (open.length === 0 ? 'no_open_orders' : 'no_match'),
      orderId: matched?.orderId,
    };
  } catch (err) {
    return { kind: 'query_error', error: err instanceof Error ? err.message : String(err) };
  }
}

function evidenceToPatch(
  evidence: Evidence,
  target: OrderLifecycle,
): { status: 'ACKED' | 'TERMINAL'; terminal_reason?: string; order_id?: string | null; outcome?: string } | null {
  if (evidence.kind === 'query_error') return null; // réseau cassé : on ne force AUCUNE conclusion
  if (evidence.remote) {
    const kind = liveStatus(evidence.remote);
    if (kind === 'open') {
      return { status: 'ACKED', order_id: evidence.remote.orderId, outcome: 'reconciled_open' };
    }
    if (kind === 'filled') {
      return {
        status: 'TERMINAL',
        terminal_reason: 'filled',
        order_id: evidence.remote.orderId,
        outcome: 'reconciled_filled',
      };
    }
    if (kind === 'canceled') {
      return {
        status: 'TERMINAL',
        terminal_reason: 'cancelled',
        order_id: evidence.remote.orderId,
        outcome: 'reconciled_cancelled',
      };
    }
    if (kind === 'rejected') {
      return {
        status: 'TERMINAL',
        terminal_reason: 'rejected',
        order_id: evidence.remote.orderId,
        outcome: 'reconciled_rejected',
      };
    }
  }
  if (evidence.remoteStatus === 'unknown' || evidence.remoteStatus === 'no_match' || evidence.remoteStatus === 'no_open_orders') {
    // introuvable chez l'exchange : instruction n'a jamais abouti (ou déjà
    // remplie/annulée, hors fenêtre de scan) → convergence "inexistante".
    // L'id local (quand il existait) est conservé à titre de trace.
    return {
      status: 'TERMINAL',
      terminal_reason: 'cancelled',
      outcome: 'not_found_on_exchange',
    };
  }
  if (target.status === 'RECONCILING') {
    // toujours non conclu : on reste en attente (pas de fausse conclusion).
    return null;
  }
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