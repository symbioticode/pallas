import { test, expect } from 'vitest';
import { ReferenceStrategy, bestAskOf, type OrderbookLike, type OrderbookReader } from './reference.js';

function book(asks: number[]): OrderbookLike {
  return {
    marketId: 'm',
    bids: [{ price: 0.1, size: 1 }],
    asks: asks.map((price) => ({ price, size: 1 })),
    fetchedAt: new Date().toISOString(),
  };
}

function staticReader(entries: Record<string, OrderbookLike | Error>): OrderbookReader {
  return {
    async getOrderbook(tokenId: string) {
      const r = entries[tokenId];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

test('signal BUY quand best ask < seuil, price = best ask, size configuree', async () => {
  const s = new ReferenceStrategy({ tokenIds: ['a'], buyThreshold: 0.6, size: 2 });
  const sig = await s.evaluate(staticReader({ a: book([0.55, 0.6]) }));
  expect(sig).not.toBeNull();
  expect(sig!.tokenId).toBe('a');
  expect(sig!.side).toBe('BUY');
  expect(sig!.price).toBe(0.55); // min des asks
  expect(sig!.size).toBe(2);
  expect(sig!.bestAsk).toBe(0.55);
});

test('aucun signal si le seul marche a un ask >= seuil', async () => {
  const s = new ReferenceStrategy({ tokenIds: ['a'], buyThreshold: 0.6, size: 1 });
  expect(await s.evaluate(staticReader({ a: book([0.6, 0.7]) }))).toBeNull();
});

test('aucun signal si la liste est vide ou le book sans asks (pas de throw, reponse neutre)', async () => {
  const s = new ReferenceStrategy({ tokenIds: ['a'], buyThreshold: 0.6, size: 1 });
  expect(await s.evaluate(staticReader({ a: { ...book([]) } }))).toBeNull();
});

test('erreur de lecture sur un token -> on passe au token suivant', async () => {
  const s = new ReferenceStrategy({ tokenIds: ['a', 'b'], buyThreshold: 0.6, size: 1 });
  const sig = await s.evaluate(staticReader({ a: new Error('network down'), b: book([0.4]) }));
  expect(sig!.tokenId).toBe('b');
  expect(sig!.price).toBe(0.4);
});

test('premier marche de la liste qui remplit la condition remporte', async () => {
  const s = new ReferenceStrategy({ tokenIds: ['a', 'b'], buyThreshold: 0.6, size: 1 });
  const sig = await s.evaluate(staticReader({ a: book([0.7]), b: book([0.5]) }));
  expect(sig!.tokenId).toBe('b');
});

test('determinisme : meme livre, meme signal', async () => {
  const s = new ReferenceStrategy({ tokenIds: ['a'], buyThreshold: 0.6, size: 1 });
  const r = staticReader({ a: book([0.5]) });
  const s1 = await s.evaluate(r);
  const s2 = await s.evaluate(r);
  expect(s1).toEqual(s2);
});

test('config invalide -> throw (constructeur fail-fast)', () => {
  expect(() => new ReferenceStrategy({ tokenIds: [], buyThreshold: 0.6, size: 1 })).toThrow();
  expect(() => new ReferenceStrategy({ tokenIds: ['a'], buyThreshold: 0, size: 1 })).toThrow();
  expect(() => new ReferenceStrategy({ tokenIds: ['a'], buyThreshold: 0.6, size: 0 })).toThrow();
});

test('bestAskOf : null sur book sans asks / prix invalides, min sinon', () => {
  expect(bestAskOf({ ...book([]) })).toBeNull();
  expect(bestAskOf(book([0.4, 0.42]))).toBe(0.4);
});