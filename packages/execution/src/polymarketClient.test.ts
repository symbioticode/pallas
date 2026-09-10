import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { PolymarketClient, SignatureSchemaNotValidatedError } from './polymarketClient.js';
import {
  __setSignatureSchemaValidatedForTests as setSchemaValidated,
} from './schemaGate.js';
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
  it('listMarkets mappe les marches CLOB', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            id: 'mkt-1',
            question: 'Le BTC depassera 120k fin 2026 ?',
            active: 'true',
            closed: 'false',
            end_date_iso: '2026-12-31T23:59:00Z',
            clob_token_ids: ['tok-yes', 'tok-no'],
            best_bid: '0.53',
            best_ask: '0.55',
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
      id: 'mkt-1',
      question: 'Le BTC depassera 120k fin 2026 ?',
      yesTokenId: 'tok-yes',
      noTokenId: 'tok-no',
      bestBid: 0.53,
      bestAsk: 0.55,
      active: true,
    });
  });

  it('getOrderbook parses prix/sizes depuis les buckets CLOB', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ bids: [['0.51', '100'], ['0.50', '250']], asks: [['0.52', '80']] })
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
      { marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY', tokenId: 'tok-yes' },
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
});