import { test, expect } from 'vitest';
import {
  POLYMARKET_DOMAIN,
  POLYMARKET_ORDER_TYPES,
  domainSeparator,
  orderTypeHash,
  signOrder,
  recoverSignerAddress,
  privateKeyToAddress,
  signEip191,
  signApiCreds,
  buildSignedOrderPayload,
} from './polymarketSigner.js';
import type { OrderToSign } from './polymarketSigner.js';

// clé privée connue (RFC6979/vecteurs standard) : priv key = 1
const PK_ONE = '0000000000000000000000000000000000000000000000000000000000000001';
const ADDR_PK_ONE = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

const baseOrder: OrderToSign = {
  salt: 1766847064778384329583297500742918515827483896875618958121606201292619776n,
  maker: '0x322135Fc8e7e0a1EfE2476c9aa8D57657436F9cB',
  signer: '0x322135Fc8e7e0a1EfE2476c9aa8D57657436F9cB',
  taker: '0x0000000000000000000000000000000000000000',
  tokenId: 71321045692408328360022118623747958115297759768786203608435393348337133299310n,
  makerAmount: 100000000n,
  takerAmount: 55000000n,
  expiration: 1779243518n,
  nonce: 0n,
  feeRateBps: 0n,
  signatureType: 1,
};

test(`privateKeyToAddress derive l'adresse connue du priv key 1`, () => {
  expect(privateKeyToAddress(PK_ONE).toLowerCase()).toBe(ADDR_PK_ONE.toLowerCase());
});

test('signOrder est deterministe et lien au signataire', () => {
  const a = signOrder(baseOrder, PK_ONE);
  const b = signOrder(baseOrder, PK_ONE);
  expect(a.digest).toBe(b.digest);
  expect(a.signature).toBe(b.signature);
  expect(a.signature).toHaveLength(130); // r||s||v = 65 octets hex
  expect([0, 1]).toContain(a.recoveryParam);
  const v = Number.parseInt(a.signature.slice(-2), 16);
  expect([27, 28]).toContain(v);
  expect(a.signer.toLowerCase()).toBe(ADDR_PK_ONE.toLowerCase());
});

test('signature non triviale : changer un champ change digest et signature', () => {
  const changed = { ...baseOrder, nonce: 42n };
  const base = signOrder(baseOrder, PK_ONE);
  const mod = signOrder(changed, PK_ONE);
  expect(base.digest).not.toBe(mod.digest);
  expect(base.signature).not.toBe(mod.signature);
});

test('recoverSignerAddress retrouve le signataire depuis le digest', () => {
  const signed = signOrder(baseOrder, PK_ONE);
  const recovered = recoverSignerAddress(signed.digest, signed.signature);
  expect(recovered.toLowerCase()).toBe(ADDR_PK_ONE.toLowerCase());
  // signatureType environnement : recovery >= 0 ; v = 27+recovery => valide
  expect(recovered).toBe(signed.signer);
});

test('orderTypeHash et domainSeparator stables et deterministes', () => {
  const th1 = Buffer.from(orderTypeHash()).toString('hex');
  const th2 = Buffer.from(orderTypeHash()).toString('hex');
  expect(th1).toBe(th2);
  expect(th1).toHaveLength(64);
  const ds = Buffer.from(domainSeparator()).toString('hex');
  expect(ds).toHaveLength(64);
  const chainId = POLYMARKET_DOMAIN.chainId;
  expect(chainId).toBe(137n);
  expect(POLYMARKET_ORDER_TYPES.Order).toHaveLength(11);
});

test('signEip191 deterministe, 65 octets, sensible au message', () => {
  const msg = 'apiKey1230';
  const s1 = signEip191(msg, PK_ONE);
  const s2 = signEip191(msg, PK_ONE);
  expect(s1).toBe(s2);
  expect(s1).toHaveLength(130);
  expect(signEip191(msg + 'x', PK_ONE)).not.toBe(s1);
});

test('signApiCreds retourne nonce/timestamp/signature exploitables', () => {
  const c = signApiCreds('apiKey-abc', 123456, 1779243518, PK_ONE);
  expect(c.nonce).toBe('123456');
  expect(c.timestamp).toBe('1779243518');
  expect(c.signature).toHaveLength(130);
});

test('gros tokenId uint256 (au dela de 64 bits) est encode sans troncature', () => {
  const order = {
    ...baseOrder,
    tokenId: 2n ** 250n + 12345n, // > u64
  };
  const signed = signOrder(order, PK_ONE);
  expect(signed.digest).toHaveLength(64);
  const recovered = recoverSignerAddress(signed.digest, signed.signature);
  expect(recovered.toLowerCase()).toBe(ADDR_PK_ONE.toLowerCase());
});

test('adresse invalide => throw', () => {
  expect(() =>
    signOrder({ ...baseOrder, maker: '0x123' } as OrderToSign, PK_ONE)
  ).toThrow(/adresse invalide/);
});

test('buildSignedOrderPayload monte un payload CLOB exploitable', () => {
  const p = buildSignedOrderPayload(
    { marketId: 'mkt-1', price: 0.55, size: 100, side: 'BUY', tokenId: 2n ** 250n + 1n },
    '0x322135Fc8e7e0a1EfE2476c9aa8D57657436F9cB',
    PK_ONE,
    { nonce: 1n }
  );
  expect(p.order.maker.toLowerCase()).toBe('0x322135fc8e7e0a1efe2476c9aa8d57657436f9cb');
  expect(p.order.taker).toBe('0x0000000000000000000000000000000000000000');
  expect(p.order.tokenId).toBe((2n ** 250n + 1n).toString());
  expect(p.order.signatureType).toBe(1);
  expect(p.order.feeRateBps).toBe('0');
  expect(p.signature).toMatch(/^0x[0-9a-f]{130}$/);
  expect(p.side).toBe('BUY');
  expect(p.price).toBe('0.55');
  expect(p.order.nonce).not.toBe('0'); // nonce aléatoire, non reproduit
});