import { describe, it, expect, vi, afterEach } from 'vitest';
import { PolymarketClient, SignatureSchemaNotValidatedError } from './polymarketClient.js';
import type { SignedOrderPayload } from './polymarketSigner.js';

const VALIDATED = (): SignedOrderPayload => ({
  order: {
    salt: '1',
    maker: '0x0000000000000000000000000000000000000001',
    signer: '0x0000000000000000000000000000000000000001',
    taker: '0x0000000000000000000000000000000000000000',
    tokenId: 'tok-yes',
    makerAmount: '10000000',
    takerAmount: '5000000',
    expiration: '2000000000',
    nonce: '424242',
    feeRateBps: '0',
    signatureType: 1,
  },
  signature: '0x' + 'ab'.repeat(65),
  owner: '0x0000000000000000000000000000000000000001',
  side: 'BUY',
  price: '0.50',
  size: '10',
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe('PolymarketClient writes (fail-closed en dry-run)', () => {
  it("placeOrder est bloque quand le flag global est dry-run (par defaut)", async () => {
    const fetcher = vi.fn();
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, isDryRun: () => true });
    await expect(
      c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY' })
    ).rejects.toThrow(/dry-run/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('placeOrder refuse sans flag signedOrdersValidated (fail-closed)', async () => {
    const fetcher = vi.fn();
    const c = new PolymarketClient({ baseUrl: 'https://fake.api', fetcher, isDryRun: () => false });
    await expect(c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY' }, VALIDATED())).
      rejects.toBeInstanceOf(SignatureSchemaNotValidatedError);
    await expect(c.placeOrder({ marketId: 'mkt-1', price: 0.5, size: 10, side: 'BUY' })).
      rejects.toBeInstanceOf(SignatureSchemaNotValidatedError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('placeOrder serialise le payload signe CLOB en mode live valide', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      jsonResponse({ orderID: 'order-42', status: 'open' })
    );
    const c = new PolymarketClient({
      baseUrl: 'https://fake.api',
      fetcher,
      isDryRun: () => false,
      signedOrdersValidated: true,
    });
    const res = await c.placeOrder({
      marketId: 'mkt-1',
      price: 0.5,
      size: 10,
      side: 'BUY',
      tokenId: 'tok-yes',
    }, VALIDATED());
    const body = JSON.parse(String(fetcher.mock.calls[0][1]!.body));
    expect(fetcher).toHaveBeenCalledWith('https://fake.api/order', expect.objectContaining({ method: 'POST' }));
    expect(body.order.makerAmount).toBe('10000000');
    expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(body.side).toBe('BUY');
    expect(res).toMatchObject({ orderId: 'order-42', status: 'open', dryRun: false });
  });

  it('cancelOrder est bloque en dry-run et part en DELETE en live', async () => {
    const dryFetcher = vi.fn();
    const dryClient = new PolymarketClient({
      baseUrl: 'https://fake.api',
      fetcher: dryFetcher,
      isDryRun: () => true,
    });
    await expect(dryClient.cancelOrder('order-42')).rejects.toThrow(/dry-run/);
    expect(dryFetcher).not.toHaveBeenCalled();

    const liveFetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const liveClient = new PolymarketClient({
      baseUrl: 'https://fake.api',
      fetcher: liveFetcher,
      isDryRun: () => false,
    });
    const res = await liveClient.cancelOrder('order-42');
    expect(liveFetcher).toHaveBeenCalledWith(
      'https://fake.api/order/order-42',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(res).toEqual({ orderId: 'order-42', cancelled: true, dryRun: false });
  });
});