import { test, expect } from 'vitest';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  ORDER_SIDE,
  POLYMARKET_DOMAIN,
  POLYMARKET_NEG_RISK_DOMAIN,
  POLYMARKET_ORDER_TYPES,
  SIGNATURE_TYPE,
  buildSignedOrderPayload,
  calculateOrderAmounts,
  clobAuthDigest,
  domainSeparator,
  encodeOrderData,
  orderDigest,
  orderStructHash,
  orderTypeHash,
  privateKeyToAddress,
  recoverSignerAddress,
  randomSalt,
  signClobAuth,
  signEip191,
  signOrder,
} from './polymarketSigner.js';
import type { OrderToSign } from './polymarketSigner.js';

// clé privée connue (RFC6979/vecteurs standard) : priv key = 1
const PK_ONE = '0000000000000000000000000000000000000000000000000000000000000001';
const ADDR_PK_ONE = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

// Ordre V2 fixe. Digests de REFERENCE calcules avec viem 2.56.3
// (impl. EIP-712 de reference, celle que recommande la doc Polymarket).
// Sources : docs.polymarket.com/trading/place-orders (schema/domain) + viem.
const FIXED_SALT = 424242424242424n;
const MAKER = '0x322135fc8e7e0a1efe2476c9aa8d57657436f9cb';
const TOKEN = 71321045692408328360022118623747958115297759768786203608435393348337133299310n;
const T_MILLIS = 1786000000000n;
const ZERO32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

// Vecteurs viem 2.56.3 (ref.mjs, PALLAS-M02-journal) :
//   BUY  : maker=5200000 (USD), taker=10000000 (shares), side=0, sigType=0, exchange standard.
//   SELL : maker=10000000 (shares), taker=5200000 (USD), side=1.
const VEC_BUY_DIGEST = '0x580449bc7be42d060ccd1ea3996a49d6480ae9c11cbebfe91fccc637d3d729a8';
const VEC_SELL_DIGEST = '0xb3180cc12d726560171c505346e7a35010ad539fe0e3c53702c4633f5b247754';
const VEC_NEG_RISK_BUY_DIGEST = '0xc348b2fa561697f18099390ba981b33a9678e7dd261b58f00ee6c56b2c4e5697';
// Vecteur EIP-712 officiel : exemple « Ether Mail » du standard.
const VEC_EIP712_MAIL_DIGEST = '0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2';
// Payload L1 ClobAuth (EIP-712) — viem : address=MAKER, timestamp="1786000000", nonce=0.
const VEC_CLOB_AUTH_DIGEST = '0x1fceabcdf6fe641c6ebd0e703449ebfcf2d1f0478c929594e702cd970b87d049';

function fixedOrder(overrides: Partial<OrderToSign> = {}): OrderToSign {
  return {
    salt: FIXED_SALT,
    maker: MAKER,
    signer: MAKER,
    tokenId: TOKEN,
    makerAmount: 5200000n,
    takerAmount: 10000000n,
    side: ORDER_SIDE.BUY,
    signatureType: SIGNATURE_TYPE.EOA,
    timestamp: T_MILLIS,
    metadata: ZERO32,
    builder: ZERO32,
    ...overrides,
  };
}

// ------------------ hasher EIP-712 de reference (independant, pour TEST) ------------------
// Implementation autonome dans ce fichier de test, calquee sur le standard EIP-712
// (encodage canonique + dependances de types + champs dynamiques), pour croiser
// les digests produits par polymarketSigner.ts et valider les vecteurs viem.

function refUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function refKeccak(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return keccak_256(buf);
}

function refPad32(bits: Uint8Array, len: number): Uint8Array {
  if (bits.length > len) throw new Error(`too long ${bits.length}/${len}`);
  const out = new Uint8Array(32);
  out.set(bits, 32 - bits.length);
  return out;
}

function refWord(big: bigint): Uint8Array {
  return refPad32(Buffer.from(big.toString(16).padStart(64, '0'), 'hex'), 32);
}

function refAddress(addr: string): Uint8Array {
  return refPad32(Buffer.from(addr.replace(/^0x/i, ''), 'hex'), 20);
}

function refBytes32(hexVal: string): Uint8Array {
  return Buffer.from(hexVal.replace(/^0x/i, ''), 'hex');
}

type RefField = { name: string; type: string };
type RefTypes = Record<string, RefField[]>;

function refEncodeType(primary: string, types: RefTypes): string {
  const deps: string[] = [];
  const visit = (t: string): void => {
    for (const f of types[t] ?? []) {
      const base = f.type.replace(/\[\]$/, '');
      if (types[base] && base !== primary && !deps.includes(base)) {
        deps.push(base);
        visit(base);
      }
    }
  };
  visit(primary);
  const direct = types[primary] ?? [];
  const primaryStr = `${primary}(${direct.map((f) => `${f.type} ${f.name}`).join(',')})`;
  const depsStr = deps
    .sort()
    .map((t) => `${t}(${types[t]!.map((f) => `${f.type} ${f.name}`).join(',')})`)
    .join('');
  return primaryStr + depsStr;
}

function refStructHash(primary: string, types: RefTypes, data: Record<string, unknown>): Uint8Array {
  const typeHash = refKeccak(refUtf8(refEncodeType(primary, types)));
  const parts: Uint8Array[] = [];
  for (const f of types[primary] ?? []) {
    if (types[f.type]) {
      parts.push(refStructHash(f.type, types, data[f.name] as Record<string, unknown>));
    } else {
      switch (f.type) {
        case 'address':
          parts.push(refAddress(String(data[f.name])));
          break;
        case 'bytes32':
          parts.push(refBytes32(String(data[f.name])));
          break;
        case 'uint8':
        case 'uint256':
          parts.push(refWord(BigInt(data[f.name] as never)));
          break;
        case 'string':
          parts.push(refKeccak(refUtf8(String(data[f.name]))));
          break;
        default:
          throw new Error(`type non gere: ${f.type}`);
      }
    }
  }
  return refKeccak(typeHash, ...parts);
}

function refDomainSeparator(domain: {
  name: string;
  version: string;
  chainId: bigint | number;
  verifyingContract?: string;
}): Uint8Array {
  const fields: RefField[] = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
  ];
  if (domain.verifyingContract !== undefined) fields.push({ name: 'verifyingContract', type: 'address' });
  return refStructHash('EIP712Domain', { EIP712Domain: fields }, domain as unknown as Record<string, unknown>);
}

function refDigest(
  primary: string,
  types: RefTypes,
  domain: { name: string; version: string; chainId: bigint | number; verifyingContract?: string },
  data: Record<string, unknown>,
): string {
  return (
    '0x' +
    Buffer.from(refKeccak(new Uint8Array([0x19, 0x01]), refDomainSeparator(domain), refStructHash(primary, types, data))).toString('hex')
  );
}

// ------------------ tests ------------------

test('privateKeyToAddress derive l adresse connue du priv key 1', () => {
  expect(privateKeyToAddress(PK_ONE).toLowerCase()).toBe(ADDR_PK_ONE.toLowerCase());
});

test('calculateOrderAmounts : BUY maker=USD & taker=shares, SELL inverse', () => {
  // BUY: maker fournit le montant monetaire et recoit les tokens.
  const buy = calculateOrderAmounts('BUY', 0.52, 10);
  expect(buy).toEqual({ makerAmount: 5_200_000n, takerAmount: 10_000_000n });
  // SELL: maker fournit les tokens et recoit le montant monetaire.
  const sell = calculateOrderAmounts('SELL', 0.52, 10);
  expect(sell).toEqual({ makerAmount: 10_000_000n, takerAmount: 5_200_000n });
  // flux de valeur : la monnaie est 0.52 × 10 = 5.20 (6 dp) dans chaque sens.
  expect(buy.makerAmount).toBe(sell.takerAmount);
  expect(buy.takerAmount).toBe(sell.makerAmount);
});

test('PALLAS-M17 : calculateOrderAmounts accepte tickSize et arrondit officiellement', () => {
  // tick 0.01 : prix arrondi a 0.33, montant 0.99 -> plus de centime fantome (1.00).
  expect(calculateOrderAmounts('BUY', 0.333333333, 3, '0.01')).toEqual({
    makerAmount: 990_000n,
    takerAmount: 3_000_000n,
  });
  // tick 0.1 : prix arrondi a 1 decimale.
  expect(calculateOrderAmounts('BUY', 0.87, 50, '0.1')).toEqual({
    makerAmount: 45_000_000n,
    takerAmount: 50_000_000n,
  });
  // tick_size hors table officielle => fail-closed.
  expect(() => calculateOrderAmounts('BUY', 0.5, 10, '0.5')).toThrow(/tick_size/);
});

test('PALLAS-M17 : signatureType non-EOA refuse a la construction (PROXY/SAFE/DEPOSIT_WALLET)', () => {
  const base = { side: 'BUY' as const, price: 0.52, size: 10, tokenId: TOKEN, salt: FIXED_SALT, timestampMillis: T_MILLIS };
  expect(() => buildSignedOrderPayload({ ...base, signatureType: SIGNATURE_TYPE.PROXY }, MAKER, PK_ONE)).toThrow(/EOA/);
  expect(() => buildSignedOrderPayload({ ...base, signatureType: SIGNATURE_TYPE.SAFE }, MAKER, PK_ONE)).toThrow(/EOA/);
  expect(() => buildSignedOrderPayload({ ...base, signatureType: SIGNATURE_TYPE.DEPOSIT_WALLET }, MAKER, PK_ONE)).toThrow(/EOA/);
});

test('orderDigest reproduit le vecteur de reference viem (exchange standard, BUY)', () => {
  const d = orderDigest(fixedOrder());
  expect('0x' + Buffer.from(d).toString('hex')).toBe(VEC_BUY_DIGEST);
});

test('orderDigest reproduit le vecteur viem pour SELL (flux inverses)', () => {
  const sell = fixedOrder({
    makerAmount: 10_000_000n,
    takerAmount: 5_200_000n,
    side: ORDER_SIDE.SELL,
  });
  expect('0x' + Buffer.from(orderDigest(sell)).toString('hex')).toBe(VEC_SELL_DIGEST);
});

test('le choix de l exchange (neg_risk) change le digest ; vecteur viem neg-risk', () => {
  const neg = fixedOrder({ makerAmount: 999_999n, takerAmount: 3_000_000n });
  const dNeg = orderDigest(neg, POLYMARKET_NEG_RISK_DOMAIN);
  expect('0x' + Buffer.from(dNeg).toString('hex')).toBe(VEC_NEG_RISK_BUY_DIGEST);
  const dStd = orderDigest(neg, POLYMARKET_DOMAIN);
  expect(Buffer.from(dNeg).toString('hex')).not.toBe(Buffer.from(dStd).toString('hex'));
  expect(POLYMARKET_NEG_RISK_DOMAIN.verifyingContract.toLowerCase()).toBe('0xe2222d279d744050d28e00520010520000310f59');
});

test('domainSeparator inclut le typeHash EIP712Domain (constat 1 PALLAS-M02)', () => {
  const ds = domainSeparator({
    name: 'Ether Mail',
    version: '1',
    chainId: 1n,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  });
  const refDs = refDomainSeparator({
    name: 'Ether Mail',
    version: '1',
    chainId: 1n,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  });
  expect('0x' + Buffer.from(ds).toString('hex')).toBe('0x' + Buffer.from(refDs).toString('hex'));
  expect(Buffer.from(ds).toString('hex')).toHaveLength(64);
});

test('encodeOrderData : chaque champ atomique occupe un mot ABI de 32 octets', () => {
  const enc = encodeOrderData(fixedOrder());
  expect(enc.length).toBe(32 + POLYMARKET_ORDER_TYPES.Order.length * 32);
  const at = (i: number): string => Buffer.from(enc.subarray(32 + i * 32, 32 + (i + 1) * 32)).toString('hex');
  // typeHash en tete.
  expect(Buffer.from(enc.subarray(0, 32)).toString('hex')).toBe(Buffer.from(orderTypeHash()).toString('hex'));
  // salt.
  expect(at(0)).toBe(FIXED_SALT.toString(16).padStart(64, '0'));
  // side et signatureType (uint8) : un MOT COMPLET de 32 octets, pas 1 octet (constat 2).
  expect(at(6)).toBe('00'.repeat(31) + '00'); // side = 0 (BUY)
  expect(at(7)).toBe('00'.repeat(31) + '00'); // signatureType = 0 (EOA)
  expect(enc.length % 32).toBe(0);
});

test('hasher de reference independant : reproduit le vecteur officiel Ether Mail', () => {
  const d = refDigest(
    'Mail',
    {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
      Mail: [
        { name: 'from', type: 'Person' },
        { name: 'to', type: 'Person' },
        { name: 'contents', type: 'string' },
      ],
    },
    { name: 'Ether Mail', version: '1', chainId: 1n, verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' },
    {
      from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
      to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
      contents: 'Hello, Bob!',
    },
  );
  expect(d).toBe(VEC_EIP712_MAIL_DIGEST);
});

test('hasher de reference independant : croise le digest d ordre Polymarket', () => {
  const ref = refDigest(
    'Order',
    { Order: POLYMARKET_ORDER_TYPES.Order as unknown as RefField[] },
    { name: 'Polymarket CTF Exchange', version: '2', chainId: 137n, verifyingContract: POLYMARKET_DOMAIN.verifyingContract },
    {
      salt: FIXED_SALT,
      maker: MAKER,
      signer: MAKER,
      tokenId: TOKEN,
      makerAmount: 5200000n,
      takerAmount: 10000000n,
      side: ORDER_SIDE.BUY,
      signatureType: SIGNATURE_TYPE.EOA,
      timestamp: T_MILLIS,
      metadata: ZERO32,
      builder: ZERO32,
    },
  );
  expect(ref).toBe(VEC_BUY_DIGEST);
  expect('0x' + Buffer.from(orderDigest(fixedOrder())).toString('hex')).toBe(ref);
});

test('signOrder deterministe, 65 octets, signataire retrouve par recuperation', () => {
  const a = signOrder(fixedOrder(), PK_ONE);
  const b = signOrder(fixedOrder(), PK_ONE);
  expect(a.digest).toBe(b.digest);
  expect(a.signature).toBe(b.signature);
  expect(a.signature).toHaveLength(130);
  const recovered = recoverSignerAddress(a.digest, a.signature);
  expect(recovered.toLowerCase()).toBe(ADDR_PK_ONE.toLowerCase());
  expect(a.signer.toLowerCase()).toBe(ADDR_PK_ONE.toLowerCase());
  // surete : la signature correspond bien au digest viem de reference.
  expect(a.digest).toBe(VEC_BUY_DIGEST.slice(2));
});

test('gros tokenId au dela de 64 bits encode sans troncature', () => {
  const order = fixedOrder({ tokenId: 2n ** 250n + 12345n });
  const signed = signOrder(order, PK_ONE);
  expect(signed.digest).toHaveLength(64);
  expect(recoverSignerAddress(signed.digest, signed.signature).toLowerCase()).toBe(ADDR_PK_ONE.toLowerCase());
});

test('adresse invalide => throw', () => {
  expect(() => signOrder({ ...fixedOrder(), maker: '0x123' }, PK_ONE)).toThrow(/adresse invalide/);
});

test('randomSalt reste dans le domaine des nombres JSON safe', () => {
  const s = randomSalt();
  expect(s).toBeGreaterThan(0n);
  expect(s).toBeLessThan(1n << 53n);
  expect(Number.isSafeInteger(Number(s))).toBe(true);
});

test('signClobAuth (L1) reproduit le vecteur viem + signature 65 octets', () => {
  const c = signClobAuth(MAKER, 1786000000, 0, PK_ONE);
  expect(c.address).toBe(MAKER);
  expect(c.timestamp).toBe('1786000000');
  expect(c.nonce).toBe('0');
  expect(c.signature).toMatch(/^0x[0-9a-f]{130}$/);
  const digest = clobAuthDigest({ address: MAKER, timestamp: '1786000000', nonce: 0n });
  expect('0x' + Buffer.from(digest).toString('hex')).toBe(VEC_CLOB_AUTH_DIGEST);
  const recovered = recoverSignerAddress(Buffer.from(digest), c.signature.slice(2));
  expect(recovered.toLowerCase()).toBe(ADDR_PK_ONE.toLowerCase());
});

test('buildSignedOrderPayload : wire V2 complet (montants, side, timestamp millis, GTC/GDT)', () => {
  const p = buildSignedOrderPayload(
    { side: 'BUY', price: 0.52, size: 10, tokenId: TOKEN, salt: FIXED_SALT, timestampMillis: T_MILLIS },
    '0x322135Fc8e7e0a1EfE2476c9aa8D57657436F9cB',
    PK_ONE,
  );
  expect(p.order.side).toBe('BUY');
  expect(p.order.signatureType).toBe(SIGNATURE_TYPE.EOA);
  expect(p.order.makerAmount).toBe('5200000'); // USD (6 dp)
  expect(p.order.takerAmount).toBe('10000000'); // shares (6 dp)
  expect(p.order.timestamp).toBe(T_MILLIS.toString()); // millisecondes
  expect(p.order.expiration).toBe('0'); // GTC par defaut
  expect(p.order.metadata).toBe(ZERO32);
  expect(p.order.builder).toBe(ZERO32);
  expect(p.order.signature).toMatch(/^0x[0-9a-f]{130}$/);
  expect(p.orderType).toBe('GTC');
  expect(Number(p.order.salt)).toBe(Number(FIXED_SALT));
  expect(p.typed.makerAmount).toBe(5_200_000n);
  expect(p.typed.takerAmount).toBe(10_000_000n);
  expect(p.typed.side).toBe(ORDER_SIDE.BUY);

  const gtd = buildSignedOrderPayload(
    { side: 'SELL', price: 0.52, size: 10, tokenId: TOKEN, salt: FIXED_SALT, timestampMillis: T_MILLIS, expirationSeconds: 2000000000n },
    '0x322135Fc8e7e0a1EfE2476c9aa8D57657436F9cB',
    PK_ONE,
  );
  expect(gtd.orderType).toBe('GTD');
  expect(gtd.order.expiration).toBe('2000000000');
  expect(gtd.order.side).toBe('SELL');
  expect(gtd.order.makerAmount).toBe('10000000'); // SELL : maker = shares
  expect(gtd.order.takerAmount).toBe('5200000'); // taker = USD
});

test('la structure Order V2 ne contient plus taker/nonce/feeRateBps/expiration', () => {
  const names = POLYMARKET_ORDER_TYPES.Order.map((f) => f.name);
  expect(names).toEqual([
    'salt', 'maker', 'signer', 'tokenId', 'makerAmount', 'takerAmount',
    'side', 'signatureType', 'timestamp', 'metadata', 'builder',
  ]);
  expect(orderStructHash(fixedOrder())).toBeDefined();
});

// ------------------ PALLAS-M08 : comparaison wire aux clients officiels V2 ------------------
// VERDICT (2026-09-10) : la premisse de l'audit v0.2 (champ `taker` dans le wire officiel V2)
// est REFUTEE. L'audit citait les clients V1 (`polymarket-js`, `py-clob-client`,
// `rs-clob-client`) : c'est dans le schema V1 que `taker`/`nonce`/`feeRateBps` existent.
// Les clients V2 officiels n'emettent AUCUN `taker` pour un ordre standard :
// - TS   Polymarket/clob-client-v2 @ 49083a618be70d6a86e15a94fac44037c3f7f616 (main actuel
//        identique) : `orderToJsonV2` (src/types/ordersV2.ts) pose `taker: order.taker`, mais
//        `OrderV2` (src/order-utils/model/orderDataV2.ts) n'a PAS de champ taker -> `undefined`
//        -> cle jetee par JSON.stringify. Le wire reel n'a pas de taker.
// - Py   Polymarket/py-clob-client-v2 @ main : `order_to_json_v2` (order_utils/model/
//        order_data_v2.py) = 13 cles "order", sans aucun taker (le plus explicite).
// - Rust Polymarket/rs-clob-client-v2 @ main : `OrderV1` (V1 only) a taker+nonce+feeRateBps ;
//        `OrderV2` (versions 2|3, src/clob/order_builder.rs) = les 11 champs signes, sans taker
//        (taker n'apparait que dans les corps RFQ, un flux separe, et dans les reponses).
// Pallas emet le formulaire V2 conforme ; `signatureSchemaValidated` reste verrouillee false.

// Struct signee officielle : src/order-utils/model/ctfExchangeV2TypedData.ts
// (clob-client-v2 @ 49083a61, identique sur main) — 11 champs, meme type que Pallas.
const OFFICIAL_CTF_EXCHANGE_V2_ORDER_STRUCT = [
  { name: 'salt', type: 'uint256' },
  { name: 'maker', type: 'address' },
  { name: 'signer', type: 'address' },
  { name: 'tokenId', type: 'uint256' },
  { name: 'makerAmount', type: 'uint256' },
  { name: 'takerAmount', type: 'uint256' },
  { name: 'side', type: 'uint8' },
  { name: 'signatureType', type: 'uint8' },
  { name: 'timestamp', type: 'uint256' },
  { name: 'metadata', type: 'bytes32' },
  { name: 'builder', type: 'bytes32' },
] as const;

// Ensemble des cles du corps `order` chez les clients officiels V2 (cf. verdict ci-dessus) :
// TS (orderToJsonV2, taker jete) = Py (order_to_json_v2) = Rust (OrderV2+expiration) => 13 cles.
const OFFICIAL_V2_ORDER_KEYS = [
  'salt', 'maker', 'signer', 'tokenId', 'makerAmount', 'takerAmount', 'side',
  'signatureType', 'timestamp', 'expiration', 'metadata', 'builder', 'signature',
] as const;

// Transcription litterale du dict `order` de py-clob-client-v2 order_to_json_v2 (source ci-dessus),
// calculee depuis les ENTREES brutes (pas depuis le payload Pallas) : c'est le corps de reference.
// `signature` est asseree separement (depend de la cle) et le key-set complet des 13 cles est
// verifie via OFFICIAL_V2_ORDER_KEYS sur le payload reel.
// Exception documentee : le client Python emet `salt` en `int`, le client TS en `int` (parseInt),
// le client Rust en string ; Pallas emet string (voir test M08 sur le type salt).
function officialV2OrderBody(input: {
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  tokenId: bigint;
  salt: bigint;
  timestampMillis: bigint;
  expiration?: string;
  metadata?: string;
  builder?: string;
}): Record<string, string | number> {
  const { makerAmount, takerAmount } = calculateOrderAmounts(input.side, input.price, input.size);
  return {
    salt: input.salt.toString(),
    maker: MAKER,
    signer: MAKER,
    tokenId: input.tokenId.toString(),
    makerAmount: makerAmount.toString(),
    takerAmount: takerAmount.toString(),
    side: input.side,
    expiration: input.expiration ?? '0',
    signatureType: 0,
    timestamp: input.timestampMillis.toString(),
    metadata: input.metadata ?? ZERO32,
    builder: input.builder ?? ZERO32,
  };
}

test('M08: la structure signee == CTF_EXCHANGE_V2_ORDER_STRUCT officiel (11 champs)', () => {
  expect(POLYMARKET_ORDER_TYPES.Order).toEqual(OFFICIAL_CTF_EXCHANGE_V2_ORDER_STRUCT);
});

test('M08: wire BUY — corps identique au client officiel V2, aucune cle taker', () => {
  const p = buildSignedOrderPayload(
    { side: 'BUY', price: 0.52, size: 10, tokenId: TOKEN, salt: FIXED_SALT, timestampMillis: T_MILLIS },
    MAKER,
    PK_ONE,
  );
  const reference = officialV2OrderBody({
    side: 'BUY', price: 0.52, size: 10, tokenId: TOKEN, salt: FIXED_SALT, timestampMillis: T_MILLIS,
  });
  const { signature, ...rest } = p.order;
  expect(rest).toEqual(reference);
  expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
  // ensemble de cles : exactement les 13 officielles, PAS de taker, aucun champ en plus.
  expect(Object.keys(p.order).sort()).toEqual([...OFFICIAL_V2_ORDER_KEYS].sort());
  expect('taker' in p.order).toBe(false);
});

test('M08: wire SELL — flux inverses, memes cles officielles, aucune cle taker', () => {
  const p = buildSignedOrderPayload(
    { side: 'SELL', price: 0.52, size: 10, tokenId: TOKEN, salt: FIXED_SALT, timestampMillis: T_MILLIS },
    MAKER,
    PK_ONE,
  );
  const reference = officialV2OrderBody({
    side: 'SELL', price: 0.52, size: 10, tokenId: TOKEN, salt: FIXED_SALT, timestampMillis: T_MILLIS,
  });
  const { signature, ...rest } = p.order;
  expect(rest).toEqual(reference);
  expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
  expect(Object.keys(p.order).sort()).toEqual([...OFFICIAL_V2_ORDER_KEYS].sort());
  expect('taker' in p.order).toBe(false);
});

test('M08: wire valides tous les champs optionnels (GTD, metadata, builder) vs officiel', () => {
  const meta = '0x' + 'ab'.repeat(32);
  const builder = '0x' + 'cd'.repeat(32);
  const p = buildSignedOrderPayload(
    {
      side: 'BUY', price: 0.33, size: 3, tokenId: TOKEN, salt: FIXED_SALT, timestampMillis: T_MILLIS,
      expirationSeconds: 2000000000n, metadata: meta, builder,
    },
    MAKER,
    PK_ONE,
  );
  const reference = officialV2OrderBody({
    side: 'BUY', price: 0.33, size: 3, tokenId: TOKEN, salt: FIXED_SALT, timestampMillis: T_MILLIS,
    expiration: '2000000000', metadata: meta, builder,
  });
  const { signature, ...rest } = p.order;
  expect(rest).toEqual(reference);
  expect('taker' in p.order).toBe(false);
});

test('M08: salt emis en string — conforme au client Rust officiel (TS/Python emettent un nombre)', () => {
  const p = buildSignedOrderPayload(
    { side: 'BUY', price: 0.52, size: 10, tokenId: TOKEN, salt: FIXED_SALT, timestampMillis: T_MILLIS },
    MAKER,
    PK_ONE,
  );
  expect(typeof p.order.salt).toBe('string');
  expect(Number(p.order.salt)).toBe(Number(FIXED_SALT));
  // divergence entre les clients officiels eux-memes (TS/Python : nombre ; Rust : string) :
  // Pallas suit le format string, sans perte de precision pour les salts < 2^53 (randomSalt).
});

// ------------------ PALLAS-M05 : zeroing des buffers de cle privee ------------------
// Preuve : le signer travaille sur une COPIE interne zeroee — jamais sur la memoire
// de l'appelant (Buffer/Uint8Array du caller intacts apres appel) — et ses vecteurs
// de reference restent identiques (determinisme non regresse).

test('signOrder : copie interne zeroee, buffer du caller intact, signature identique (PALLAS-M05)', () => {
  const callerBuf = Buffer.from(PK_ONE, 'hex');
  const viaBuffer = signOrder(fixedOrder(), callerBuf);
  expect(callerBuf.toString('hex')).toBe(PK_ONE); // on n'a pas zeroe la memoire du caller
  const viaString = signOrder(fixedOrder(), PK_ONE);
  expect(viaBuffer.signature).toBe(viaString.signature); // determinisme preservé
  expect(viaBuffer.signer.toLowerCase()).toBe(ADDR_PK_ONE.toLowerCase());
});

test('privateKeyToAddress : Uint8Array du caller intact apres usage (PALLAS-M05)', () => {
  const caller = Uint8Array.from(Buffer.from(PK_ONE, 'hex'));
  const addr = privateKeyToAddress(caller);
  expect(addr.toLowerCase()).toBe(ADDR_PK_ONE.toLowerCase());
  expect(Buffer.from(caller).toString('hex')).toBe(PK_ONE);
});

test('signClobAuth + signEip191 : Buffer du caller intact, signatures valides (PALLAS-M05)', () => {
  const buf = Buffer.from(PK_ONE, 'hex');
  const c = signClobAuth(MAKER, 1786000000, 0, buf);
  expect(buf.toString('hex')).toBe(PK_ONE);
  expect(c.signature).toMatch(/^0x[0-9a-f]{130}$/);
  const e = signEip191('hello', buf);
  expect(buf.toString('hex')).toBe(PK_ONE);
  expect(e).toMatch(/^[0-9a-f]{130}$/);
  // signature EIP-191 recuperable vers la bonne adresse.
  const recovered = recoverSignerAddress(keccak_256(Buffer.concat([Buffer.from('\u0019Ethereum Signed Message:\n5'), Buffer.from('hello')])), e);
  expect(recovered.toLowerCase()).toBe(ADDR_PK_ONE.toLowerCase());
});

test('cle privee de taille invalide => erreur claire, aucune signature rendue (PALLAS-M05)', () => {
  expect(() => signOrder(fixedOrder(), '01')).toThrow(/doit faire 32 octets/);
  expect(() => privateKeyToAddress(Uint8Array.from([1, 2, 3]))).toThrow(/doit faire 32 octets/);
});