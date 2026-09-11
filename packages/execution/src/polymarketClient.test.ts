import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { PolymarketClient, AmbiguousOrderError, ClobValidationError, OrderMismatchError, SignatureSchemaNotValidatedError, KillSwitchEngagedError } from './polymarketClient.js';
import {
  __setSignatureSchemaValidatedForTests as setSchemaValidated,
} from './schemaGate.js';
import { setGlobalKillSwitch, getGlobalKillSwitch } from './killSwitch.js';
import { buildSignedOrderPayload, clobAuthDigest, recoverSignerAddress } from './polymarketSigner.js';
import type { SignedOrderPayload } from './polymarketSigner.js';

// clé privée connue (priv key = 1) + adresse dérivée.
const PK_ONE = '0000000000000000000000000000000000000000000000000000000000000001';
const ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

const CREDS = {
  address: ADDR,
  apiKey: 'api-key-1',
  secret: 'aGVsbG8=', // base64('hello') : secret arbitraire pour le HMAC, pas une vraie clé
  passphrase: 'passephrase-1',
};

/** Recalcule le HMAC L2 de maniere INDEPENDANTE (node:crypto, pas clobAuth.ts). */
function recomputeL2(secret: string, timestamp: string, method: string, path: string, body?: string): string {
  const message = `${timestamp}${method}${path}${body ?? ''}`;
  return createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(message)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_'); // padding '=' conservé (parité docs)
}

function signedBuy(salt = 424242424242424n): SignedOrderPayload {
  return buildSignedOrderPayload(
    { side: 'BUY', price: 0.5, size: 10, tokenId: 12345n, salt, timestampMillis: 1786000000000n },
    ADDR,
    PK_ONE,
  );
}

function jsonResponse(payload: unknown): globalThis.Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('PolymarketClient reads (dry-run safe)', () => {
  it('listMarkets mappe les marches CLOB (shape live tokens[])', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            condition_id: '0xcond-1',
            question: 'Le BTC depassera 120k fin 2026 ?',
            active: 'true',
            closed: 'false',
            fpmm: '0xfpmm',
            neg_risk: false,
            end_date_iso: '2026-12-31T23:59:00Z',
            tokens: [
              { token_id: 'tok-yes', outcome: 'Yes', price: '0.53', winner: null },
              { token_id: 'tok-no', outcome: 'No', price: '0.47', winner: null },
            ],
          },
        ],
      })
    );
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher });
    const markets = await c.listMarkets(5);
    expect(fetcher).toHaveBeenCalledWith(
      'https://fake.api/markets?limit=5&active=true&closed=false',
      expect.objectContaining({ method: 'GET' })
    );
    expect(markets).toHaveLength(1);
    expect(markets[0]).toMatchObject({
      id: '0xcond-1',
      question: 'Le BTC depassera 120k fin 2026 ?',
      yesTokenId: 'tok-yes',
      noTokenId: 'tok-no',
      // best_bid/best_ask supprimes de /markets par l'API ; prix a lire via /book.
      bestBid: null,
      bestAsk: null,
      active: true,
    });
  });

  it('drift API 2026-09-09: outcome libre (Democratic/Republican, token vide) => tokens nuls, pas de fabri cation', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            condition_id: '0xcond-multi',
            question: 'Quel parti gagnera ?',
            tokens: [
              { token_id: 'tok-dem', outcome: 'Democratic', price: '0.40', winner: null },
              { token_id: 'tok-rep', outcome: 'Republican', price: '0.60', winner: null },
            ],
          },
          {
            condition_id: '0xcond-vide',
            question: 'Marche pas encore ne ?',
            tokens: [
              { token_id: '', outcome: '', price: null, winner: null },
              { token_id: '', outcome: '', price: null, winner: null },
            ],
          },
        ],
      })
    );
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher });
    const markets = await c.listMarkets(5);
    expect(markets).toHaveLength(2);
    expect(markets[0]).toMatchObject({ id: '0xcond-multi', yesTokenId: null, noTokenId: null });
    expect(markets[1]).toMatchObject({ id: '0xcond-vide', yesTokenId: null, noTokenId: null });
  });

  it('getOrderbook parses les buckets objets {price, size}', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        market: '0xcond-1',
        asset_id: 'tok-yes',
        timestamp: '1789008100148',
        hash: 'abc123',
        bids: [{ price: '0.51', size: '100' }, { price: '0.50', size: '250' }],
        asks: [{ price: '0.52', size: '80' }],
      })
    );
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher });
    const book = await c.getOrderbook('tok-yes');
    expect(book.marketId).toBe('tok-yes');
    expect(book.bids[0]).toEqual({ price: 0.51, size: 100 });
    expect(book.bids[1]).toEqual({ price: 0.5, size: 250 });
    expect(book.asks[0]).toEqual({ price: 0.52, size: 80 });
    expect(book.fetchedAt).toBeTruthy();
  });

  it('erreur HTTP => throw avec code et corps', async () => {
    const fetcher = vi.fn(async () => new Response('rate limit', { status: 429 }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher });
    await expect(c.listMarkets(1)).rejects.toThrow(/429/);
  });

  it('drift API 2026-09-09: ancienne forme (id + clob_token_ids + best_bid) => ClobValidationError', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            id: 'mkt-x',
            question: 'Ancien format doc, retiré de l API live ?',
            active: 'true',
            closed: 'false',
            clob_token_ids: ['tok-yes', 'tok-no'],
            best_bid: '0.53',
            best_ask: '0.55',
          },
        ],
      })
    );
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher });
    await expect(c.listMarkets(1)).rejects.toBeInstanceOf(ClobValidationError);
  });

  it('M04: tokens absent => ClobValidationError (identifiants obligatoires)', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            condition_id: '0xcond-x',
            question: 'Marché sans tokens ?',
            active: 'true',
            closed: 'false',
          },
        ],
      })
    );
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher });
    await expect(c.listMarkets(1)).rejects.toBeInstanceOf(ClobValidationError);
  });

  it('drift API 2026-09-09: bucket paire [price, size] (ancien format) => ClobValidationError', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        bids: [{ price: '0.51', size: '100' }],
        asks: [['0.52', '80', 'extra']],
      })
    );
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher });
    await expect(c.getOrderbook('tok-yes')).rejects.toBeInstanceOf(ClobValidationError);
  });
});

describe('PolymarketClient writes — fail-closed', () => {
  afterEach(() => setSchemaValidated(false));

  it('placeOrder est bloque quand le flag global est dry-run (par defaut)', async () => {
    const fetcher = vi.fn();
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => true });
    await expect(
      c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY' }, signedBuy())
    ).rejects.toThrow(/dry-run/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('placeOrder refuse sans preuve de schema valide (fail-closed), meme avec credentials', async () => {
    const fetcher = vi.fn();
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    await expect(c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY' }, signedBuy()))
      .rejects.toBeInstanceOf(SignatureSchemaNotValidatedError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('placeOrder refuse sans credentials API en live, meme schema valide', async () => {
    const fetcher = vi.fn();
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, isDryRun: () => false });
    setSchemaValidated(true);
    await expect(c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY' }, signedBuy()))
      .rejects.toThrow(/credentials API requises/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('cancelOrder est bloque en dry-run et refuse sans credentials en live', async () => {
    const dryFetcher = vi.fn();
    const dryClient = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher: dryFetcher, isDryRun: () => true });
    await expect(dryClient.cancelOrder('order-42')).rejects.toThrow(/dry-run/);
    expect(dryFetcher).not.toHaveBeenCalled();

    const liveNoAuth = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher: vi.fn(), isDryRun: () => false });
    await expect(liveNoAuth.cancelOrder('order-42')).rejects.toThrow(/credentials API requises/);
  });

  it('deriveApiKey est bloque en dry-run', async () => {
    const fetcher = vi.fn();
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, isDryRun: () => true });
    await expect(c.deriveApiKey(PK_ONE)).rejects.toThrow(/dry-run/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('PolymarketClient writes — live valide', () => {
  beforeEach(() => setSchemaValidated(true));
  afterEach(() => setSchemaValidated(false));

  it('placeOrder emet POST /order conforme au wire V2 avec auth L2 validee (HMAC recalcule)', async () => {
    const fetcher = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) => jsonResponse({ orderID: 'order-42', status: 'open' }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    const res = await c.placeOrder(
      { marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY', tokenId: '12345' }, // tokenId coherent avec le signe
      signedBuy(),
    );

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://fake.api/order');
    expect(init!.method).toBe('POST');

    const headers = init!.headers as Record<string, string>;
    const body = JSON.parse(String(init!.body));
    // Corps wire V2 (docs place-orders) :
    expect(body.deferExec).toBe(false);
    expect(body.orderType).toBe('GTC');
    expect(body.owner).toBe(CREDS.apiKey);
    expect(body.postOnly).toBeUndefined();
    expect(body.order.side).toBe('BUY');
    expect(body.order.makerAmount).toBe('5000000'); // BUY : maker = USD (0.5 × 10)
    expect(body.order.takerAmount).toBe('10000000'); //        taker = shares
    expect(body.order.signature).toMatch(/^0x[0-9a-f]{130}$/);

    // Auth L2 : reconstitue le HMAC avec node:crypto et le message exact.
    expect(headers['POLY_ADDRESS']).toBe(ADDR);
    expect(headers['POLY_API_KEY']).toBe(CREDS.apiKey);
    const ts = headers['POLY_TIMESTAMP'];
    const method = init!.method!;
    const path = '/order';
    expect(headers['POLY_SIGNATURE']).toBe(recomputeL2(CREDS.secret, ts, method, path, JSON.stringify(body)));

    expect(res).toMatchObject({ orderId: 'order-42', status: 'open', dryRun: false });
  });

  it('placeOrder passe postOnly=true quand demande', async () => {
    const fetcher = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) => jsonResponse({ orderID: 'order-43', status: 'open' }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    await c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY' }, signedBuy(1n), { postOnly: true });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]!.body));
    expect(body.postOnly).toBe(true);
  });

  it('placeOrder refuse HTTP => throw', async () => {
    const fetcher = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) => new Response('{"errorMsg":"insufficient balance"}', { status: 400 }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    await expect(c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY' }, signedBuy(2n)))
      .rejects.toThrow(/400/);
  });

  it('cancelOrder emet DELETE /order/{id} avec auth L2 validee', async () => {
    const fetcher = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) => new Response('{}', { status: 200 }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    const res = await c.cancelOrder('order-42');

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://fake.api/order/order-42');
    expect(init!.method).toBe('DELETE');
    const headers = init!.headers as Record<string, string>;
    expect(headers['POLY_SIGNATURE']).toBe(recomputeL2(CREDS.secret, headers['POLY_TIMESTAMP'], 'DELETE', '/order/order-42'));
    expect(res).toEqual({ orderId: 'order-42', cancelled: true, dryRun: false });
  });

  it('deriveApiKey emet GET /auth/derive-api-key avec headers L1 et signature recouverable', async () => {
    const fetcher = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ apiKey: 'ak', secret: 'sc', passphrase: 'pp' })
    );
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, isDryRun: () => false });
    const creds = await c.deriveApiKey(PK_ONE, 0n);

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://fake.api/auth/derive-api-key');
    expect(init!.method).toBe('GET');
    const headers = init!.headers as Record<string, string>;
    expect(headers['POLY_ADDRESS'].toLowerCase()).toBe(ADDR.toLowerCase());
    expect(headers['POLY_NONCE']).toBe('0');

    // La signature L1 doit etre une EIP-712 ClobAuth valide du wallet.
    const ts = headers['POLY_TIMESTAMP'];
    const digest = clobAuthDigest({ address: headers['POLY_ADDRESS'], timestamp: ts, nonce: 0n });
    const signer = recoverSignerAddress(Buffer.from(digest), headers['POLY_SIGNATURE'].slice(2));
    expect(signer.toLowerCase()).toBe(ADDR.toLowerCase());

    expect(creds).toEqual({ apiKey: 'ak', secret: 'sc', passphrase: 'pp' });
  });

  it('M04: timeout sur placeOrder => AmbiguousOrderError et AUCUN retry auto (double-placement)', async () => {
    // L'API CLOB n'a PAS de cle d'idempotence (docs place-orders) : retenter un POST
    // apres timeout pourrait placer DEUX ordres. On ne reessaye donc jamais : on leve
    // une erreur "reponse inconnue" explicite que l'appelant doit reconcilier.
    const fetcher = vi.fn(
      async () =>
        new Promise<never>((_resolve, reject) => {
          const e = new Error('The operation was aborted');
          e.name = 'TimeoutError';
          reject(e);
        })
    );
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    await expect(c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY' }, signedBuy(3n)))
      .rejects.toBeInstanceOf(AmbiguousOrderError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('M04: 5xx sur placeOrder => AmbiguousOrderError, pas de retry (reponse serveur inconnue)', async () => {
    const fetcher = vi.fn(async () => new Response('gateway timeout', { status: 502 }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    await expect(c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY' }, signedBuy(4n)))
      .rejects.toBeInstanceOf(AmbiguousOrderError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('M04: cancelOrder retente les erreurs reseau transitoires (DELETE idempotent par orderId)', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    const res = await c.cancelOrder('order-42');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(res).toEqual({ orderId: 'order-42', cancelled: true, dryRun: false });
  });

  it('M04: cancelOrder ne retente PAS un 404 (definitif)', async () => {
    const fetcher = vi.fn(async () => new Response('not found', { status: 404 }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    await expect(c.cancelOrder('order-42')).rejects.toThrow(/404/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('PALLAS-M10 — frontières résiduelles', () => {
  beforeEach(() => setSchemaValidated(true));
  afterEach(() => setSchemaValidated(false));

  it('M10: placeOrder rejette si le prix signe diverge de params (OrderMismatchError, AUCUN appel reseau)', async () => {
    const fetcher = vi.fn();
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    // signed pour price 0.5 / size 10 ; params declare price 0.9 => maker USD 5M vs 9M
    await expect(c.placeOrder({ marketId: 'mkt-1', price: 0.9, size: 10, side: 'BUY' }, signedBuy(5n)))
      .rejects.toBeInstanceOf(OrderMismatchError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('M10: placeOrder rejette si la side signee diverge de params', async () => {
    const fetcher = vi.fn();
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    await expect(c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'SELL' }, signedBuy(6n)))
      .rejects.toBeInstanceOf(OrderMismatchError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('M10: placeOrder accepte quand params == signe (tokenId explicite coherent)', async () => {
    const fetcher = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) => jsonResponse({ orderID: 'order-m10', status: 'open' }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    const res = await c.placeOrder(
      { marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY', tokenId: '12345' },
      signedBuy(7n),
    );
    expect(res.orderId).toBe('order-m10');
  });

  it('M10: deriveApiKey HTTP 401 => erreur HTTP explicite, pas de parsing JSON confus', async () => {
    const fetcher = vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher: fetcher as unknown as typeof fetch, isDryRun: () => false });
    await expect(c.deriveApiKey(PK_ONE, 7n)).rejects.toThrow(/401/);
  });

  it('M10: deriveApiKey HTTP 500 => erreur HTTP explicite', async () => {
    const fetcher = vi.fn(async () => new Response('boom', { status: 500 }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher: fetcher as unknown as typeof fetch, isDryRun: () => false });
    await expect(c.deriveApiKey(PK_ONE, 8n)).rejects.toThrow(/500/);
  });
});

describe('PALLAS-M14 — kill switch au point d\'émission', () => {
  beforeEach(() => {
    setSchemaValidated(true);
    setGlobalKillSwitch(true);
  });
  afterEach(() => {
    setSchemaValidated(false);
    setGlobalKillSwitch(false);
  });

  it('placeOrder => KillSwitchEngagedError quand le flag global est engagé, AUCUN POST', async () => {
    const fetcher = vi.fn();
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    await expect(c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY' }, signedBuy(9n)))
      .rejects.toBeInstanceOf(KillSwitchEngagedError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('placeOrder FONCTIONNE quand le kill switch est désengagé (flag global)', async () => {
    setGlobalKillSwitch(false);
    const fetcher = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) => jsonResponse({ orderID: 'order-42', status: 'open' }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    const res = await c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY' }, signedBuy(10n));
    expect(res.orderId).toBe('order-42');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('le flag peut être INJECTÉ (isKillSwitchEngaged) indépendamment du global', async () => {
    setGlobalKillSwitch(false);
    const fetcher = vi.fn();
    const c = new PolymarketClient({
      baseUrl: 'https://fake.api',
      fetcher,
      auth: CREDS,
      isDryRun: () => false,
      isKillSwitchEngaged: () => true,
    });
    await expect(c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY' }, signedBuy(11n)))
      .rejects.toBeInstanceOf(KillSwitchEngagedError);
    expect(getGlobalKillSwitch()).toBe(false); // il refusait MAIS sans toucher au global
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('PALLAS-M14 — lectures ordres (getOpenOrders / getOrder)', () => {
  beforeEach(() => setSchemaValidated(true));
  afterEach(() => setSchemaValidated(false));

  it('getOpenOrders GET /data/orders avec auth L2, maker + filter_state=open, et mappe vers ReadOrder', async () => {
    const fetcher = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({
        data: [
          {
            asset_id: 'tok-yes',
            price: '0.50',
            size: '2.5',
            original_size: '5',
            side: 'BUY',
            maker: ADDR.toLowerCase(),
            taker: '0x0',
            orderID: 'order-open-1',
            status: 'open',
          },
        ],
      })
    );
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    const orders = await c.getOpenOrders(ADDR, { filterState: 'open' });

    const [url, init] = fetcher.mock.calls[0];
    const path = `/data/orders?maker=${encodeURIComponent(ADDR)}&filter_state=open`;
    expect(url).toBe(`https://fake.api${path}`);
    expect(init!.method).toBe('GET');
    const headers = init!.headers as Record<string, string>;
    expect(headers['POLY_SIGNATURE']).toBe(recomputeL2(CREDS.secret, headers['POLY_TIMESTAMP'], 'GET', path));

    expect(orders).toHaveLength(1);
    expect(orders[0]).toEqual({
      orderId: 'order-open-1',
      assetId: 'tok-yes',
      side: 'BUY',
      price: 0.5,
      size: 2.5,
      originalSize: 5,
      status: 'open',
      maker: ADDR.toLowerCase(),
    });
  });

  it('getOpenOrders reste une LECTURE autorisée en dry-run (aucun effet de bord)', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ data: [] }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => true });
    const orders = await c.getOpenOrders(ADDR, { filterState: 'open' });
    expect(orders).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('getOpenOrders refuse sans credentials en live (lecture authentifiée)', async () => {
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher: vi.fn(), isDryRun: () => false });
    await expect(c.getOpenOrders(ADDR)).rejects.toThrow(/credentials API requises/);
  });

  it('getOrder GET /data/order/{id} et mappe la carte CLOB', async () => {
    const fetcher = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({
        asset_id: 'tok-yes',
        price: '0.48',
        size: '3',
        side: 'SELL',
        maker: ADDR.toLowerCase(),
        orderID: 'order-single-7',
        status: 'filled',
      })
    );
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    const order = await c.getOrder('order-single-7');

    const [url, init] = fetcher.mock.calls[0];
    const path = '/data/order/order-single-7';
    expect(url).toBe(`https://fake.api${path}`);
    const headers = init!.headers as Record<string, string>;
    expect(headers['POLY_SIGNATURE']).toBe(recomputeL2(CREDS.secret, headers['POLY_TIMESTAMP'], 'GET', path));

    expect(order).toMatchObject({
      orderId: 'order-single-7',
      assetId: 'tok-yes',
      side: 'SELL',
      price: 0.48,
      size: 3,
      status: 'filled',
    });
  });
});

describe('PALLAS-M14 — cancelAllOrders (primitive de sortie du kill switch)', () => {
  it('est bloqué en dry-run (écriture)', async () => {
    const fetcher = vi.fn();
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, isDryRun: () => true });
    await expect(c.cancelAllOrders()).rejects.toThrow(/dry-run/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuse sans credentials en live', async () => {
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher: vi.fn(), isDryRun: () => false });
    await expect(c.cancelAllOrders()).rejects.toThrow(/credentials API requises/);
  });

  it('live : DELETE /cancel-all avec auth L2, retour cancelled', async () => {
    const fetcher = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) => jsonResponse({ success: true }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    const res = await c.cancelAllOrders();

    const [url, init] = fetcher.mock.calls[0];
    const path = '/cancel-all';
    expect(url).toBe(`https://fake.api${path}`);
    expect(init!.method).toBe('DELETE');
    const headers = init!.headers as Record<string, string>;
    expect(headers['POLY_SIGNATURE']).toBe(recomputeL2(CREDS.secret, headers['POLY_TIMESTAMP'], 'DELETE', path));

    expect(res).toEqual({ cancelled: true, dryRun: false });
  });

  it('live : success:false => erreur explicite (échec de la primitive de sortie)', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ success: false, errorMsg: 'too many requests' }));
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, auth: CREDS, isDryRun: () => false });
    await expect(c.cancelAllOrders()).rejects.toThrow(/cancel-all refuse/);
  });
});