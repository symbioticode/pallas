/**
 * PALLAS-M14 — Réconciliation des ordres (CUSTOM) avec la réalité de l'exchange.
 *
 * Scénarios :
 *  - ordre AMBIGUOUS retrouvé OUVERT chez l'exchange → ACKED (id réel) ;
 *  - ordre AMBIGUOUS introuvable dans les ordres ouverts → TERMINAL cancelled ;
 *  - ordre avec order_id connu : getOrder -> open/filled/404 → convergence exacte ;
 *  - réseau cassé (500) → AUCUNE conclusion forcée, statut RECONCILING conservé ;
 *  - invariant M13 : l'état passe durablement par RECONCILING AVANT tout appel réseau ;
 *  - le gate d'émission (orchestrateur) bloque un scope portant une empreinte vive ;
 *  - kill switch : enforceKillSwitch borne la sortie à UN SEUL cancel-all.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PolymarketClient,
  AmbiguousOrderError,
  setGlobalKillSwitch,
  getGlobalKillSwitch,
} from '@pallas/execution';
import { FileLedger } from '@pallas/ledger';

import { ReferenceStrategy } from './reference.js';
import { runReferenceCycle } from './run-reference-loop.js';
import {
  DurableStateStore,
  exposureFromOrders,
  newLifecycle,
  transitionLifecycle,
  type OrderLifecycle,
} from './durable-state.js';
import {
  reconcileOrder,
  reconcileAtStartup,
  enforceKillSwitch,
  scopeHasLiveFootprint,
} from './reconciliation.js';

afterEach(() => {
  setGlobalKillSwitch(false);
  vi.unstubAllEnvs();
});

const PK_ONE = '0000000000000000000000000000000000000000000000000000000000000001';
const ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const CREDS = { address: ADDR, apiKey: 'api-key-1', secret: 'aGVsbG8=', passphrase: 'passephrase-1' };
const TOKEN = '1234567890123456789012345678901234567890123456789012345678901234';

const VALID_STATE_JSON =
  '{"hist_pnls":[],"kill_switch_engaged":false,' +
  '"circuit_breaker":{"state":"Closed","consecutive_losses":0,"cumulative_pnl":0,"peak_pnl":0,"since_trip":0},' +
  '"volatility":{"window":[],"baseline":null},"exposure":[]}';

/** Configuration de risque de test (opérateur) — jamais portée par un trade. */
const TEST_RISK_CONFIG = {
  bankroll_usd: 1000,
  max_order_usd: 25,
  max_portfolio_exposure_usd: 1000,
  max_drawdown_usd: 300,
  max_concentration_usd: 1000,
  half_open_probe_size_usd: 5,
  var_min_observations: 2,
  var_startup_envelope_usd: 100,
  max_market_data_age_ms: 600000,
};

const DECISION_ALLOW =
  `{"decision":{"allowed":true,"gates":[],"rejected_by":[],"suggested_size_usd":25},"state":${VALID_STATE_JSON}}`;

function fakeRiskBinary(stdout: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pallas-recon-fake-risk-'));
  const bin = join(dir, 'risk-engine');
  const quoted = stdout.replace(/'/g, "'\\''");
  writeFileSync(bin, `#!/bin/sh\ncat > /dev/null\nprintf '%s' '${quoted}'\nexit 0\n`, { mode: 0o755 });
  return bin;
}

/** Client contrôlé : routes /data/orders, /data/order, /book, live (pas dry-run). */
function liveClient(routes: {
  openOrders?: Array<Record<string, unknown>>;
  order?: Record<string, unknown> | ((id: string) => Record<string, unknown>);
  /** PALLAS-M22 : historique de trades/fills (preuve positive d'exécution). */
  trades?: Array<Record<string, unknown>>;
  /** Si fourni, le POST /order répond avec ce statut (simule un AmbiguousOrderError). */
  placeOrderStatus?: number;
}): PolymarketClient {
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/order') && init?.method === 'POST') {
      if (routes.placeOrderStatus != null) {
        return new Response('gateway timeout', { status: routes.placeOrderStatus });
      }
      return new Response(JSON.stringify({ orderID: 'order-placed-1', status: 'open' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/data/trades')) {
      return new Response(JSON.stringify({ data: routes.trades ?? [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/data/orders')) {
      return new Response(JSON.stringify({ data: routes.openOrders ?? [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/data/order/')) {
      const id = url.split('/data/order/')[1];
      const payload = typeof routes.order === 'function' ? routes.order(id) : routes.order;
      if (!payload) return new Response('{"error":"not found"}', { status: 404 });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/book')) {
      const book = { bids: [{ price: '0.40', size: '100' }], asks: [{ price: '0.50', size: '50' }] };
      return new Response(JSON.stringify(book), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/cancel-all')) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404 });
  };
  return new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
}

const openClobOrder = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  asset_id: TOKEN,
  price: '0.50',
  size: '1',
  original_size: '1',
  side: 'BUY',
  maker: ADDR.toLowerCase(),
  taker: '0x0',
  orderID: 'order-open-1',
  status: 'open',
  ...over,
});

/** PALLAS-M22 — un TRADE (fill) tel que renvoyé par `GET /data/trades`. */
const openTrade = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'trade-1',
  taker_order_id: '0x' + 'a'.repeat(40),
  market: '0x' + '1'.repeat(64),
  asset_id: TOKEN,
  side: 'BUY',
  size: '1',
  price: '0.50',
  status: 'TRADE_STATUS_CONFIRMED',
  match_time: String(Math.floor(Date.now() / 1000)),
  outcome: 'YES',
  maker_address: ADDR.toLowerCase(),
  trader_side: 'MAKER',
  ...over,
});

/**
 * PALLAS-M22 — recule `created_at`. La conclusion « annulé par absence »
 * n'est autorisée qu'après une fenêtre d'observation écoulée
 * (`MIN_ABSENT_CANCEL_AGE_MS`) : on ne conclut jamais trop tôt.
 */
function aged(o: OrderLifecycle, ageMs = 5 * 60_000): OrderLifecycle {
  return { ...o, created_at: new Date(Date.now() - ageMs).toISOString() };
}

function setupStore(): { store: DurableStateStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pallas-recon-'));
  return { store: new DurableStateStore(join(dir, 'risk-state.json')), dir };
}

async function pushOrder(store: DurableStateStore, order: OrderLifecycle): Promise<void> {
  await store.withLock((doc) => {
    doc.orders.push(order);
    store.write(doc);
  });
}

describe('réconciliation — convergence d\'UN ordre', () => {
  test('AMBIGUOUS retourné OUVERT (scan open) => ACKED avec le vrai order_id', async () => {
    const { store } = setupStore();
    const ambiguous = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'AMBIGUOUS', outcome: 'pending_reconciliation' },
    );
    await pushOrder(store, ambiguous);
    const client = liveClient({
      // prouve l'invariant M13 : au moment où l'exchange est interrogé, l'état
      // est DÉJÀ durablement RECONCILING (transition écrite avant le réseau).
      openOrders: [
        openClobOrder({ orderID: 'order-open-1' }),
      ],
    });

    const res = await reconcileOrder({ store, client, maker: ADDR }, ambiguous.correlationId);
    expect(res?.convergence).toBe('ACKED');
    expect(res?.orderId).toBe('order-open-1');
    const doc = store.read();
    const o = doc.orders[0];
    expect(o.status).toBe('ACKED');
    expect(o.order_id).toBe('order-open-1');
    expect(o.terminal_reason).toBeUndefined();
    expect(o.outcome).toBe('reconciled_open');
  });

  test('invariant M13 — RECONCILING est DURABLE avant tout appel réseau', async () => {
    const { store } = setupStore();
    const ambiguous = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'AMBIGUOUS', outcome: 'pending_reconciliation' },
    );
    await pushOrder(store, ambiguous);

    let sawPreNetwork = false;
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/data/orders')) {
        sawPreNetwork = store.read().orders[0].status === 'RECONCILING';
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    };
    const client = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });

    await reconcileOrder({ store, client, maker: ADDR }, ambiguous.correlationId);
    expect(sawPreNetwork).toBe(true); // l'état était RECONCILING quand le scan est parti
  });

  test('AMBIGUOUS absent des DEUX sources (ordres ouverts ET trades) après fenêtre => TERMINAL cancelled / not_found_on_exchange', async () => {
    const { store } = setupStore();
    const ambiguous = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'AMBIGUOUS', outcome: 'pending_reconciliation' },
    );
    // PALLAS-M22 : l'absence ne conclut qu'après une fenêtre d'observation
    // écoulée (sinon l'ordre resterait RECONCILING, cf. test dédié plus bas).
    await pushOrder(store, aged(ambiguous));
    const client = liveClient({ openOrders: [], trades: [] });

    const res = await reconcileOrder({ store, client, maker: ADDR }, ambiguous.correlationId);
    expect(res?.convergence).toBe('TERMINAL');
    const doc = store.read();
    const o = doc.orders[0];
    expect(o.status).toBe('TERMINAL');
    expect(o.terminal_reason).toBe('cancelled');
    expect(o.order_id).toBeNull();
    expect(o.outcome).toBe('not_found_on_exchange');
  });

  test('ordre avec order_id connu : getOrder -> open => ACKED', async () => {
    const { store } = setupStore();
    const submitted = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'SUBMITTED', order_id: 'order-k-1' },
    );
    await pushOrder(store, submitted);
    const client = liveClient({ order: openClobOrder({ orderID: 'order-k-1' }) });

    const res = await reconcileOrder({ store, client, maker: ADDR }, submitted.correlationId);
    expect(res?.convergence).toBe('ACKED');
    const doc = store.read();
    expect(doc.orders[0].status).toBe('ACKED');
    expect(doc.orders[0].order_id).toBe('order-k-1');
  });

  test('ordre avec order_id connu : getOrder -> filled => TERMINAL filled', async () => {
    const { store } = setupStore();
    const submitted = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'AMBIGUOUS', order_id: 'order-k-2' },
    );
    await pushOrder(store, submitted);
    const client = liveClient({ order: openClobOrder({ orderID: 'order-k-2', status: 'filled' }) });

    const res = await reconcileOrder({ store, client, maker: ADDR }, submitted.correlationId);
    expect(res?.convergence).toBe('TERMINAL');
    const o = store.read().orders[0];
    expect(o.status).toBe('TERMINAL');
    expect(o.terminal_reason).toBe('filled');
    expect(o.order_id).toBe('order-k-2');
  });

  test('getOrder 404 (id inconnu de l\'exchange) => convergence "inexistante", jamais de ré-émission', async () => {
    const { store } = setupStore();
    const submitted = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'SUBMITTED', order_id: 'order-ghost' },
    );
    await pushOrder(store, submitted);
    const client = liveClient({ order: undefined as never });

    const res = await reconcileOrder({ store, client, maker: ADDR }, submitted.correlationId);
    expect(res?.convergence).toBe('TERMINAL');
    const o = store.read().orders[0];
    expect(o.status).toBe('TERMINAL');
    expect(o.terminal_reason).toBe('cancelled');
    expect(o.order_id).toBe('order-ghost'); // l'id local reste tracé, résultat non-inventé
  });

  test('réseau cassé (500) => AUCUNE conclusion forcée, reste RECONCILING', async () => {
    const { store } = setupStore();
    const ambiguous = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'AMBIGUOUS', outcome: 'pending_reconciliation' },
    );
    await pushOrder(store, ambiguous);
    const fetcher = async () => new Response('boom', { status: 500 });
    const client = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });

    const res = await reconcileOrder({ store, client, maker: ADDR }, ambiguous.correlationId);
    expect(res?.convergence).toBe('UNCHANGED');
    const o = store.read().orders[0];
    expect(o.status).toBe('RECONCILING'); // pas d'ACK fabriqué, pas de TERMINAL forcé
    expect(scopeHasLiveFootprint(store, TOKEN)).toBe(true); // le scope reste barré
  });

  // ---------------------------------------------------------------------------
  // PALLAS-M22 — réconciliation par fills réels (audit v0.4 F-03/F-04)
  // ---------------------------------------------------------------------------

  test("scénario AUDIT v0.4 : ordre totalement REMPLI, absent des ordres ouverts, sans order_id => filled par preuve de trade, jamais cancelled", async () => {
    const { store } = setupStore();
    const ambiguous = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'AMBIGUOUS', outcome: 'pending_reconciliation' },
    );
    await pushOrder(store, ambiguous);
    // L'ordre a disparu des ordres ouverts parce qu'il est TOTALEMENT REMPLI
    // (c'est le bug historique : absence d'ordre ouvert => faux « cancelled »).
    // L'historique des trades porte la preuve POSITIVE de l'exécution.
    const client = liveClient({ openOrders: [], trades: [openTrade({ size: '1' })] });

    const res = await reconcileOrder({ store, client, maker: ADDR }, ambiguous.correlationId);
    expect(res?.convergence).toBe('TERMINAL');
    const o = store.read().orders[0];
    expect(o.status).toBe('TERMINAL');
    expect(o.terminal_reason).toBe('filled');
    expect(o.outcome).toBe('reconciled_filled_by_trade');
    // Une position réelle n'est plus une « empreinte vivante » : le scope est
    // libéré parce que l'ordre est RÉGLÉ, pas parce qu'on a supposé son absence.
    expect(scopeHasLiveFootprint(store, TOKEN)).toBe(false);
  });

  test("M22 : remplissage PARTIEL => ACKED (reste vivant), ni filled ni cancelled", async () => {
    const { store } = setupStore();
    const ambiguous = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 2, est_value_usd: 1 }),
      { status: 'AMBIGUOUS', outcome: 'pending_reconciliation' },
    );
    await pushOrder(store, ambiguous);
    const client = liveClient({ openOrders: [], trades: [openTrade({ size: '1' })] });

    await reconcileOrder({ store, client, maker: ADDR }, ambiguous.correlationId);
    const o = store.read().orders[0];
    expect(o.status).toBe('ACKED');
    expect(o.outcome).toBe('reconciled_partial_fill');
    // Le solde de l'ordre reste à exécuter : le scope DOIT rester bloqué.
    expect(scopeHasLiveFootprint(store, TOKEN)).toBe(true);
  });

  test("M22 : une SEULE source en erreur => aucune conclusion, reste RECONCILING, scope bloqué", async () => {
    const { store } = setupStore();
    const ambiguous = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'AMBIGUOUS', outcome: 'pending_reconciliation' },
    );
    // Fenêtre écoulée : c'est l'ERREUR réseau (pas l'âge) qui doit interdire la conclusion.
    await pushOrder(store, aged(ambiguous));
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/data/trades')) return new Response('boom', { status: 500 });
      if (url.includes('/data/orders')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    };
    const client = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });

    const res = await reconcileOrder({ store, client, maker: ADDR }, ambiguous.correlationId);
    expect(res?.convergence).toBe('UNCHANGED');
    const o = store.read().orders[0];
    expect(o.status).toBe('RECONCILING');
    expect(o.terminal_reason).toBeUndefined();
    expect(scopeHasLiveFootprint(store, TOKEN)).toBe(true);
  });

  test("M22 : fenêtre trop courte (ordre récent, les deux sources vides) => RECONCILING, pas de cancelled prématuré", async () => {
    const { store } = setupStore();
    const ambiguous = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'AMBIGUOUS', outcome: 'pending_reconciliation' },
    );
    await pushOrder(store, ambiguous); // created_at = maintenant
    const client = liveClient({ openOrders: [], trades: [] });

    const res = await reconcileOrder({ store, client, maker: ADDR }, ambiguous.correlationId);
    expect(res?.convergence).toBe('UNCHANGED');
    expect(store.read().orders[0].status).toBe('RECONCILING');
    expect(scopeHasLiveFootprint(store, TOKEN)).toBe(true);
  });

  test("M22 : jamais soumis avec succès, absent des DEUX sources après fenêtre => cancelled (seule condition légitime)", async () => {
    const { store } = setupStore();
    const ambiguous = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'AMBIGUOUS', outcome: 'pending_reconciliation' },
    );
    await pushOrder(store, aged(ambiguous));
    const client = liveClient({ openOrders: [], trades: [] });

    const res = await reconcileOrder({ store, client, maker: ADDR }, ambiguous.correlationId);
    expect(res?.convergence).toBe('TERMINAL');
    const o = store.read().orders[0];
    expect(o.status).toBe('TERMINAL');
    expect(o.terminal_reason).toBe('cancelled');
    expect(o.outcome).toBe('not_found_on_exchange');
  });

  test("M22 : order_id connu mais getOrder 404, fill présent dans les trades => filled (preuve positive)", async () => {
    const { store } = setupStore();
    const submitted = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'SUBMITTED', order_id: 'order-ghost' },
    );
    await pushOrder(store, submitted);
    const client = liveClient({ order: undefined as never, openOrders: [], trades: [openTrade({ size: '1' })] });

    const res = await reconcileOrder({ store, client, maker: ADDR }, submitted.correlationId);
    expect(res?.convergence).toBe('TERMINAL');
    const o = store.read().orders[0];
    expect(o.terminal_reason).toBe('filled');
    expect(o.order_id).toBe('order-ghost'); // l'id local reste tracé
  });

  test("M22 : une position reconnue 'filled' par les trades COMPTE dans l'exposition (plus jamais effacée par un faux cancelled)", async () => {
    const { store } = setupStore();
    const ambiguous = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 7 }),
      { status: 'AMBIGUOUS', outcome: 'pending_reconciliation' },
    );
    await pushOrder(store, ambiguous);
    const client = liveClient({ openOrders: [], trades: [openTrade({ size: '1' })] });

    await reconcileOrder({ store, client, maker: ADDR }, ambiguous.correlationId);
    // Avant M22, l'absence d'ordre ouvert aurait conclu « cancelled », et
    // exposureFromOrders (qui ignore les terminaux annulés) aurait RETIRÉ
    // cette position : sous-évaluation exactement au pire moment. Désormais
    // la preuve de fill alimente l'exposition.
    expect(exposureFromOrders(store.read().orders)).toEqual([{ market_id: TOKEN, size_usd: 7 }]);
  });
});

describe('réconciliation — scope & tour de garde', () => {
  function cycleOpts(
    store: DurableStateStore,
    dir: string,
    client: PolymarketClient,
  ): (over?: Record<string, unknown>) => Parameters<typeof runReferenceCycle>[1] {
    const ledger = FileLedger.load(join(dir, 'ledger.json'));
    return (over: Record<string, unknown> = {}) =>
      ({
        client,
        strategy: new ReferenceStrategy({ tokenIds: [TOKEN], buyThreshold: 0.6, size: 1 }),
        ledger,
        statePath: store.path,
        riskConfig: TEST_RISK_CONFIG,
        signer: { address: ADDR, privKey: PK_ONE },
        ...over,
      }) as Parameters<typeof runReferenceCycle>[1];
  }

  test('un scope portant une empreinte VIVE (ACKED ouvert) est bloqué — rejected_by SCOPE_RECONCILING', async () => {
    vi.stubEnv('PALLAS_RISK_BIN', fakeRiskBinary(DECISION_ALLOW));
    const { store, dir } = setupStore();
    const live = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'ACKED', order_id: 'order-live-1', outcome: 'acked' },
    );
    await pushOrder(store, live);
    // L'exchange confirme que l'ordre est TOUJOURS OUVERT (le local porte un
    // order_id, la preuve passe donc par getOrder) : la réconciliation ne peut
    // pas libérer le scope => le cycle DOIT être refusé.
    const client = liveClient({
      openOrders: [openClobOrder({ orderID: 'order-live-1' })],
      order: openClobOrder({ orderID: 'order-live-1' }),
    });
    const opts = cycleOpts(store, dir, client);

    const result = await runReferenceCycle(1, opts());
    expect(result.allowed).toBe(false);
    expect(result.rejected_by).toContain('SCOPE_RECONCILING');
    expect(result.execution).toBe('not_attempted');
    expect(result.correlation_id).toBeNull();
    // AUCUN ordre supplémentaire émis : le scope n'a pas doublé la position.
    expect(store.read().orders).toHaveLength(1);
  });

  test('un AMBIGUOUS résolu en TERMINAL libère le scope : le cycle suivant émet', async () => {
    vi.stubEnv('PALLAS_RISK_BIN', fakeRiskBinary(DECISION_ALLOW));
    const { store, dir } = setupStore();
    const ghost = transitionLifecycle(
      newLifecycle({ market_id: TOKEN, side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'AMBIGUOUS', outcome: 'pending_reconciliation' },
    );
    // PALLAS-M22 : absence confirmée par les deux sources ET fenêtre écoulée.
    await pushOrder(store, aged(ghost));
    // L'exchange ne connaît PAS cet ordre : il est convergé TERMINAL, le scope
    // est libre, le cycle peut alors valider et tenter d'émettre (dry-run stricte).
    const client = liveClient({ openOrders: [] });
    const opts = cycleOpts(store, dir, client);

    const result = await runReferenceCycle(1, opts());
    expect(result.allowed).toBe(true);
    expect(result.rejected_by).toEqual([]);
    // 2 ordres : l'ancien TERMINAL + le nouveau (DECIDED/SUBMITTING selon fin de cycle).
    const doc = store.read();
    expect(doc.orders).toHaveLength(2);
    expect(doc.orders.find((o) => o.correlationId === ghost.correlationId)?.status).toBe('TERMINAL');
  });

  test('AmbiguousOrderError (502) => réconciliation immédiate converge ACKED avec le vrai order_id', async () => {
    vi.stubEnv('PALLAS_RISK_BIN', fakeRiskBinary(DECISION_ALLOW));
    const { store, dir } = setupStore();
    // Le POST /order répond en 502 (résultat indéterminé) ; l'ordre existe pourtant
    // chez l'exchange (ordre ouvert à 0.50/1 part) : la réconciliation IMMÉDIATE
    // (sans attendre un cycle suivant) doit le retrouver et l'ACKer avec son id réel.
    const client = liveClient({
      openOrders: [openClobOrder({ orderID: 'order-x-1' })],
    });
    // Simule un AmbiguousOrderError à l'émission (la vraie 502 est testée dans
    // packages/execution ; ici l'orchestrateur reste au schéma de signature fermé,
    // la passerelle étant une décision de mission — le POST n'est donc jamais atteint).
    vi.spyOn(client, 'placeOrder').mockImplementation(async () => {
      throw new AmbiguousOrderError('simulated gateway timeout');
    });
    const opts = cycleOpts(store, dir, client);

    const result = await runReferenceCycle(1, opts());
    expect(result.execution).toBe('execution_error'); // AmbiguousOrderError est journalisé
    const o = store.read().orders[0];
    expect(o.status).toBe('ACKED'); // réconciliation immédiate, pas d'AMBIGUOUS résiduel
    expect(o.order_id).toBe('order-x-1');
    expect(o.outcome).toBe('reconciled_open');
    // trace legered : la réconciliation s'est effectuée directement après l'ambiguïté
    expect(
      opts().ledger.entries.some((e) => e.event === 'order_reconciled_on_ambiguity'),
    ).toBe(true);
    // Surtout : le scope est barré (ordre ouvert confirmé), le cycle suivant ne doit
    // PAS ré-émettre doublon.
    expect(scopeHasLiveFootprint(store, TOKEN)).toBe(true);
  });
});

describe('réconciliation au démarrage', () => {
  test('recense un ordre OUVERT externe absent de l\'état local comme ACKED "externé"', async () => {
    const { store } = setupStore();
    // Un ordre local résolu (non bloquant) + un ordre externe vivant.
    const doneLocal = transitionLifecycle(
      newLifecycle({ market_id: 'other-token', side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
      { status: 'TERMINAL', terminal_reason: 'cancelled', outcome: 'dry_run_blocked' },
    );
    await pushOrder(store, doneLocal);

    const client = liveClient({ openOrders: [openClobOrder({ orderID: 'external-1' })] });
    const res = await reconcileAtStartup({ store, client, maker: ADDR });

    expect(res.externalOrders).toContain(TOKEN);
    const o = store.read().orders.find((x) => x.order_id === 'external-1');
    expect(o).toBeDefined();
    expect(o?.status).toBe('ACKED');
    expect(o?.outcome).toBe('external_found_at_startup');
  });
});

describe('enforceKillSwitch — une seule sortie, idempotente', () => {
  test('kill switch désengagé : synchronise le flag global à false, aucun cancel-all', async () => {
    setGlobalKillSwitch(true); // simulateur d'un engagement résiduel du process
    const { store } = setupStore();
    const client = liveClient({});
    const res = await enforceKillSwitch(store, client);
    expect(res.engaged).toBe(false);
    expect(res.cancelAll).toBe('not_needed');
    expect(getGlobalKillSwitch()).toBe(false); // la vérité persistée a été resynchronisée
  });

  test('engagement initial : cancelAllOrders appelé UNE fois, meta borné (pas de double sortie)', async () => {
    const { store } = setupStore();
    await store.withLock((doc) => {
      doc.risk.kill_switch_engaged = true;
      store.write(doc);
    });
    let cancels = 0;
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/cancel-all')) {
        cancels += 1;
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    };
    const client = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });

    const res1 = await enforceKillSwitch(store, client);
    expect(res1.cancelAll).toBe('called');
    expect(cancels).toBe(1);
    const res2 = await enforceKillSwitch(store, client);
    expect(res2.cancelAll).toBe('not_needed'); // idempotent : jamais de second cancel-all
    expect(cancels).toBe(1);
    const meta = (store.read().meta ?? {}) as Record<string, unknown>;
    expect(meta.kill_switch_cancelall_called).toBe(true);
  });

  test('dry-run : cancel-all bloqué par le dry-run (jamais marqué comme fait)', async () => {
    const { store } = setupStore();
    await store.withLock((doc) => {
      doc.risk.kill_switch_engaged = true;
      store.write(doc);
    });
    const client = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher: vi.fn(), auth: CREDS, isDryRun: () => true });
    const res = await enforceKillSwitch(store, client);
    expect(res.cancelAll).toBe('dry_run_blocked');
    // la méta ne doit PAS prétendre que la sortie a eu lieu : on pourra re-tenter en live.
    expect((store.read().meta ?? {})).not.toHaveProperty('kill_switch_cancelall_called');
  });
});