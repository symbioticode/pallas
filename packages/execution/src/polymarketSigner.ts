/**
 * Signature CLOB Polymarket V2 — EIP-712 (ordre) + EIP-712 ClobAuth (credentials L1).
 *
 * Sources verifiees le 2026-09-09 :
 * - docs.polymarket.com/trading/place-orders  (structure Order V2, domain, montants, wire)
 * - docs.polymarket.com/getting-started/api    (auth L1 ClobAuth + L2 HMAC headers)
 * - verification croisee DES digests via viem 2.56.3 (impl. de reference) : voir tests.
 *
 * Schema V2 signe (11 champs, PAS de taker/nonce/feeRateBps/expiration) :
 *   Order(uint256 salt,address maker,address signer,uint256 tokenId,
 *         uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,
 *         uint256 timestamp,bytes32 metadata,bytes32 builder)
 *   domain : name "Polymarket CTF Exchange", version "2", chainId 137,
 *            verifyingContract = exchange (standard ou neg-risk selon le marche).
 *
 * GATE : tant que le schema n'a PAS ete valide contre l'API live, aucun ordre
 * signe n'est emis (fail-closed). Voir `schemaGate.ts` — plus AUCUN booléen de
 * constructeur ne permet de contourner cette preuve (PALLAS-M02, constat 5).
 *
 * Crypto 100% pure JS (@noble) : secp256k1 (RFC6979), keccak256.
 *
 * MEMOIRE (PALLAS-M05) : chaque fonction qui recoit une cle privee travaille sur
 * une COPIE Buffer dediee, zeroee (`.fill(0)`) dans un `finally` apres usage. Les
 * strings sources (hex) restent non-effaçables en JS pur — voir docs/SECURITY.md.
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

type RecoverSignature = (
  signature: Uint8Array,
  message: Uint8Array
) => Uint8Array;

// noble 1.x ne type pas recoverPublicKey sur le module `secp256k1` (gap de typages)
const recoverStatic = secp256k1 as unknown as { recoverPublicKey: RecoverSignature };

/** Type atomique EIP-712 du domaine (standard, identique pour standard et neg-risk). */
export const EIP712_DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';

/** Verifyng contracts CLOB (docs place-orders : "Select the Exchange and Signing Path"). */
export const POLYMARKET_EXCHANGES = {
  standard: '0xE111180000d2663C0091e4f400237545B87B996B',
  negRisk: '0xe2222d279d744050d28e00520010520000310F59',
} as const;

/** Domain EIP-712 d'un exchange Polymarket (version "2"). */
export type PolymarketDomain = {
  name: string;
  version: string;
  chainId: bigint;
  verifyingContract: string;
};

function polymarketDomain(verifyingContract: string): PolymarketDomain {
  return {
    name: 'Polymarket CTF Exchange',
    version: '2',
    chainId: 137n,
    verifyingContract,
  };
}

/** Domain EIP-712 de l'exchange standard (version "2"). */
export const POLYMARKET_DOMAIN: PolymarketDomain = polymarketDomain(POLYMARKET_EXCHANGES.standard);

/** Domain EIP-712 de l'exchange neg-risk (meme nom, contract different). */
export const POLYMARKET_NEG_RISK_DOMAIN: PolymarketDomain = polymarketDomain(POLYMARKET_EXCHANGES.negRisk);

/** Structure EIP-712 de l'ordre CLOB V2 (11 champs signes, sans expiration). */
export const POLYMARKET_ORDER_TYPES = {
  Order: [
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
  ],
} as const;

export const ORDER_TYPE_STRING =
  'Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)';

/** side (typed data) : 0=BUY, 1=SELL — et signature types (docs place-orders). */
export const ORDER_SIDE = { BUY: 0, SELL: 1 } as const;
export const SIGNATURE_TYPE = { EOA: 0, PROXY: 1, SAFE: 2, DEPOSIT_WALLET: 3 } as const;

/** Domain/type du payload L1 ClobAuth (docs getting-started/api). */
export const CLOB_AUTH_DOMAIN = {
  name: 'ClobAuthDomain',
  version: '1',
  chainId: 137n,
} as const;

export const CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: 'address', type: 'address' },
    { name: 'timestamp', type: 'string' },
    { name: 'nonce', type: 'uint256' },
    { name: 'message', type: 'string' },
  ],
} as const;

export const CLOB_AUTH_MESSAGE =
  'This message attests that I control the given wallet';

export interface OrderToSign {
  salt: bigint;
  maker: string;
  signer: string;
  tokenId: bigint;
  makerAmount: bigint;
  takerAmount: bigint;
  /** 0 = BUY, 1 = SELL. */
  side: number;
  signatureType: number;
  /** Unix millisecondes (champ signe). */
  timestamp: bigint;
  /** bytes32 hex (0x + 64 hex) — zeros par defaut. */
  metadata: string;
  builder: string;
}

export interface SignedOrder {
  /** signature 65 octets hex (r||s||v), sans 0x */
  signature: string;
  recoveryParam: number;
  digest: string;
  signer: string;
}

// ------------------ utilitaires bas niveau ------------------

function keccak(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return keccak_256(buf);
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Pad a 32 octets big-endian une valeur atomique (uint/address/bytes32). */
function pad32(raw: Uint8Array, bits: 256 | 160): Uint8Array {
  const len = bits === 160 ? 20 : 32;
  if (raw.length > len) throw new Error(`valeur atomique trop longue (${raw.length} octets)`);
  const out = new Uint8Array(32);
  out.set(raw.length === len ? raw : raw.slice(raw.length - Math.min(raw.length, len)), 32 - raw.length);
  return out;
}

function toBytesUint(v: bigint | number | string): Uint8Array {
  const big = typeof v === 'bigint' ? v : BigInt(v);
  if (big < 0n) throw new Error('uint negatif');
  if (big > (1n << 256n) - 1n) throw new Error('uint depasse 256 bits');
  const hex = big.toString(16);
  const bn = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  return pad32(bn, 256);
}

function toBytesAddress(addr: string): Uint8Array {
  const clean = addr.replace(/^0x/i, '');
  if (clean.length !== 40) throw new Error(`adresse invalide: ${addr}`);
  return pad32(Buffer.from(clean, 'hex'), 160);
}

function toBytes32(hexVal: string): Uint8Array {
  const clean = hexVal.replace(/^0x/i, '');
  if (clean.length !== 64) throw new Error(`bytes32 invalide: ${hexVal}`);
  return Buffer.from(clean, 'hex');
}

// ------------------ EIP-712 bas niveau ------------------

/** typeHash = keccak(encodeType(Order)). */
export function orderTypeHash(): Uint8Array {
  return keccak(utf8(ORDER_TYPE_STRING));
}

/**
 * domainSeparator conforme au standard : keccak(EIP712DomainTypeHash || nameHash ||
 * versionHash || chainId || verifyingContract). Le typeHash du domaine etait
 * OMIS par la version precedente (PALLAS-M02, constat 1).
 */
export function domainSeparator(domain: { name: string; version: string; chainId: bigint; verifyingContract?: string }): Uint8Array {
  const hasContract = domain.verifyingContract !== undefined;
  const typeString = hasContract
    ? EIP712_DOMAIN_TYPE
    : 'EIP712Domain(string name,string version,uint256 chainId)';
  const parts: Uint8Array[] = [
    keccak(utf8(typeString)),
    keccak(utf8(domain.name)),
    keccak(utf8(domain.version)),
    toBytesUint(domain.chainId),
  ];
  if (hasContract) {
    parts.push(toBytesAddress(domain.verifyingContract!));
  }
  return keccak(...parts);
}

/**
 * Encodage EIP-712 des champs atomiques de l'ordre : typeHash || (11 × 32 octets).
 * Chaque champ atomique (y compris side/signatureType, uint8) occupe UN MOT
 * ABI de 32 octets (PALLAS-M02, constat 2).
 */
export function encodeOrderData(order: OrderToSign): Uint8Array {
  const words = [
    orderTypeHash(),
    toBytesUint(order.salt),
    toBytesAddress(order.maker),
    toBytesAddress(order.signer),
    toBytesUint(order.tokenId),
    toBytesUint(order.makerAmount),
    toBytesUint(order.takerAmount),
    toBytesUint(order.side),
    toBytesUint(order.signatureType),
    toBytesUint(order.timestamp),
    toBytes32(order.metadata),
    toBytes32(order.builder),
  ];
  const total = words.reduce((n, w) => n + w.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const w of words) {
    buf.set(w, off);
    off += w.length;
  }
  return buf;
}

export function orderStructHash(order: OrderToSign): Uint8Array {
  return keccak(encodeOrderData(order));
}

/** Digest final EIP-712 : keccak(0x19 0x01 || domainSeparator || structHash). */
export function orderDigest(order: OrderToSign, domain = POLYMARKET_DOMAIN): Uint8Array {
  return keccak(new Uint8Array([0x19, 0x01]), domainSeparator(domain), orderStructHash(order));
}

// ------------------ cles privees : copies Buffer effacees (PALLAS-M05) ------------------

/**
 * Copie de travail d'une cle privee (hex string ou bytes) dans un Buffer de 32
 * octets. Toujours `Buffer.from` : on ne zero JAMais la memoire de l'appelant,
 * seulement notre copie (vie dans un `try/finally` + `fill(0)` au niveau appelant).
 * Les STRING sources demeurent non-effaçables en JS pur (docs/SECURITY.md).
 */
function toKeyBuffer(privKey: Uint8Array | string): Buffer {
  const buf =
    typeof privKey === 'string'
      ? Buffer.from(privKey.replace(/^0x/i, ''), 'hex')
      : Buffer.from(privKey);
  if (buf.length !== 32) {
    buf.fill(0);
    throw new Error('cle privee invalide : doit faire 32 octets');
  }
  return buf;
}

/** Dérive l'adresse Ethereum depuis une clé privée (hex ou Uint8Array). */
export function privateKeyToAddress(privKey: Uint8Array | string): string {
  const pk = toKeyBuffer(privKey);
  try {
    const pub = secp256k1.getPublicKey(pk, false); // 65 octets [0x04, x, y]
    const hash = keccak_256(pub.slice(1));
    const addr = hash.slice(-20);
    return '0x' + Buffer.from(addr).toString('hex');
  } finally {
    pk.fill(0);
  }
}

/**
 * Signe un ordre CLOB V2 (EIP-712). Signature r||s||v(27+recovery), hex sans 0x.
 */
export function signOrder(order: OrderToSign, privKey: Uint8Array | string, domain = POLYMARKET_DOMAIN): SignedOrder {
  const digest = orderDigest(order, domain);
  const pk = toKeyBuffer(privKey);
  try {
    const sig = secp256k1.sign(digest, pk);
    const compact = sig.toCompactRawBytes(); // r||s (64)
    const recovery = sig.recovery;
    if (recovery === undefined) throw new Error('signature sans recovery bit');
    const signature = Buffer.concat([Buffer.from(compact), Buffer.from([27 + recovery])]).toString('hex');
    return {
      signature,
      recoveryParam: recovery,
      digest: Buffer.from(digest).toString('hex'),
      signer: privateKeyToAddress(privKey),
    };
  } finally {
    pk.fill(0);
  }
}

/** Récupère l'adresse du signataire depuis un digest + signature (65 octets r||s||v). */
export function recoverSignerAddress(digest: Uint8Array | string, signatureHex: string): string {
  const sig = Buffer.from(signatureHex, 'hex');
  if (sig.length !== 65) throw new Error('signature doit faire 65 octets');
  const recid = sig[64] >= 27 ? sig[64] - 27 : sig[64];
  if (![0, 1, 2, 3].includes(recid)) throw new Error('recovery id invalide');
  // noble attend [recid][r][s] pour le format 'recovered', pas r||s||v
  const recovered = new Uint8Array(65);
  recovered[0] = recid;
  recovered.set(sig.subarray(0, 64), 1);
  const msg = digest instanceof Uint8Array ? digest : Buffer.from(digest, 'hex');
  const pubCompressed = recoverStatic.recoverPublicKey(recovered, msg);
  const pubUncompressed = secp256k1.ProjectivePoint.fromBytes(pubCompressed).toBytes(false);
  const hash = keccak_256(pubUncompressed.slice(1));
  return '0x' + Buffer.from(hash.slice(-20)).toString('hex');
}

/** Signature personnelle EIP-191 (utile hors CLOB). */
export function signEip191(message: string, privKey: Uint8Array | string): string {
  const prefix = utf8(`\u0019Ethereum Signed Message:\n${message.length}`);
  const digest = keccak(prefix, utf8(message));
  const pk = toKeyBuffer(privKey);
  try {
    const sig = secp256k1.sign(digest, pk);
    const recovery = sig.recovery;
    if (recovery === undefined) throw new Error('signature sans recovery bit');
    return Buffer.concat([Buffer.from(sig.toCompactRawBytes()), Buffer.from([27 + recovery])]).toString('hex');
  } finally {
    pk.fill(0);
  }
}

// ------------------ credentials L1 (EIP-712 ClobAuth) ------------------

export const CLOB_AUTH_TYPE_STRING =
  'ClobAuth(address address,string timestamp,uint256 nonce,string message)';

/** typeHash du type ClobAuth */
export function clobAuthTypeHash(): Uint8Array {
  return keccak(utf8(CLOB_AUTH_TYPE_STRING));
}

/**
 * Hash struct du payload ClobAuth L1 (EIP-712). Remplace l'ancien schéma EIP-191
 * "concat apiKey+nonce+timestamp" (PALLAS-M02, constat 6 + docs getting-started/api).
 */
export function clobAuthStructHash(message: { address: string; timestamp: string; nonce: bigint }): Uint8Array {
  return keccak(
    clobAuthTypeHash(),
    toBytesAddress(message.address),
    keccak(utf8(message.timestamp)),
    toBytesUint(message.nonce),
    keccak(utf8(CLOB_AUTH_MESSAGE)),
  );
}

/** Digest EIP-712 du payload ClobAuth. */
export function clobAuthDigest(message: { address: string; timestamp: string; nonce: bigint }): Uint8Array {
  return keccak(
    new Uint8Array([0x19, 0x01]),
    domainSeparator(CLOB_AUTH_DOMAIN as unknown as { name: string; version: string; chainId: bigint; verifyingContract?: string }),
    clobAuthStructHash(message),
  );
}

/**
 * Signature L1 pour creer/deriver les credentials API (EIP-712 ClobAuth).
 * Envoie { nonce, timestamp, signature } + address a /auth/create-api-key ou
 * /auth/derive-api-key.
 */
export function signClobAuth(
  address: string,
  timestampSeconds: bigint | number,
  nonce: bigint | number,
  privKey: Uint8Array | string
): { address: string; nonce: string; timestamp: string; signature: string } {
  const ts = timestampSeconds.toString();
  const n = BigInt(nonce);
  const digest = clobAuthDigest({ address, timestamp: ts, nonce: n });
  const pk = toKeyBuffer(privKey);
  try {
    const sig = secp256k1.sign(digest, pk);
    const recovery = sig.recovery;
    if (recovery === undefined) throw new Error('signature sans recovery bit');
    return {
      address,
      nonce: n.toString(),
      timestamp: ts,
      signature: `0x${Buffer.concat([Buffer.from(sig.toCompactRawBytes()), Buffer.from([27 + recovery])]).toString('hex')}`,
    };
  } finally {
    pk.fill(0);
  }
}

// ------------------ ordre CLOB signe ------------------

/** Tokens Polymarket : 6 decimales. */
export const CLOB_DECIMALS = 1_000_000n;

/**
 * Montants maker/taker selon le sens de l'ordre (docs place-orders) :
 * - BUY  : maker = montant monetaire (price×size), taker = nombre de shares.
 * - SELL : maker = nombre de shares, taker = montant monetaire (price×size).
 * Les montants sont en unites 6 decimales.
 */
export function calculateOrderAmounts(side: 'BUY' | 'SELL', price: number, size: number): { makerAmount: bigint; takerAmount: bigint } {
  if (!(price > 0) || !(size > 0)) throw new Error('price et size doivent etre positifs');
  const usd = BigInt(Math.round(price * size * 1_000_000));
  const shares = BigInt(Math.round(size * 1_000_000));
  if (side === 'BUY') {
    return { makerAmount: usd, takerAmount: shares };
  }
  return { makerAmount: shares, takerAmount: usd };
}

/** Salt aleatoire dans [1, 2^53) : serialise en nombre JSON sur le wire (safe). */
export function randomSalt(): bigint {
  const cryptoObj = globalThis.crypto as unknown as { getRandomValues(a: Uint8Array): void };
  const bytes = new Uint8Array(7);
  cryptoObj.getRandomValues(bytes);
  const big = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  return (big % (1n << 53n)) + 1n;
}

export interface SignedOrderPayload {
  /** Objet `order` exact du corps POST /order (docs place-orders). */
  order: {
    salt: string;
    maker: string;
    signer: string;
    tokenId: string;
    makerAmount: string;
    takerAmount: string;
    side: 'BUY' | 'SELL';
    signatureType: number;
    /** Unix millisecondes (champ signe). */
    timestamp: string;
    metadata: string;
    builder: string;
    /** Unix secondes ; "0" pour un GTC (champ non signe). */
    expiration: string;
    signature: string;
  };
  /** orderType est HORS du typed data signe (docs place-orders). */
  orderType: 'GTC' | 'GTD';
  /** Champs signes, pour inspection/test. */
  typed: OrderToSign;
}

export interface SignedOrderParams {
  tokenId?: bigint | null;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  /** "0" = GTC ; sinon timestamp seconds GTD. */
  expirationSeconds?: bigint | string;
  signatureType?: number;
  exchangeAddress?: string;
  salt?: bigint;
  timestampMillis?: bigint;
  metadata?: string;
  builder?: string;
}

/**
 * Construit l'ordre CLOB V2 signe conforme au wire actuel : domain version "2",
 * 11 champs signes (pas de taker/nonce/feeRateBps), montants dans le bon sens.
 *
 * GATE (PALLAS-M02) : cette fonction N'ENVOIE rien ; l'emission est verrouillee
 * par `assertSignatureSchemaValidated()` dans le client tant que le schema n'a
 * pas ete valide contre l'API live.
 */
export function buildSignedOrderPayload(
  params: SignedOrderParams,
  signerAddress: string,
  privKey: Uint8Array | string
): SignedOrderPayload {
  const { makerAmount, takerAmount } = calculateOrderAmounts(params.side, params.price, params.size);
  const sideBits = params.side === 'BUY' ? ORDER_SIDE.BUY : ORDER_SIDE.SELL;
  const signatureType = params.signatureType ?? SIGNATURE_TYPE.EOA;
  const expirationSeconds = params.expirationSeconds !== undefined
    ? params.expirationSeconds.toString()
    : '0';
  const domain = params.exchangeAddress
    ? { ...POLYMARKET_DOMAIN, verifyingContract: params.exchangeAddress.toLowerCase() }
    : POLYMARKET_DOMAIN;
  const signer = signerAddress.toLowerCase();

  const typed: OrderToSign = {
    salt: params.salt ?? randomSalt(),
    maker: signer,
    signer,
    tokenId: params.tokenId ?? 0n,
    makerAmount,
    takerAmount,
    side: sideBits,
    signatureType,
    timestamp: params.timestampMillis ?? BigInt(Date.now()),
    metadata: params.metadata ?? '0x' + '00'.repeat(32),
    builder: params.builder ?? '0x' + '00'.repeat(32),
  };

  // Ordonner les champs du wire : signature non vide => ce payload est pret a
  // etre emis ; verifier la porte de validation du schema (fail-closed).
  const signed = signOrder(typed, privKey, domain);

  return {
    order: {
      salt: typed.salt.toString(),
      maker: typed.maker,
      signer: typed.signer,
      tokenId: typed.tokenId.toString(),
      makerAmount: typed.makerAmount.toString(),
      takerAmount: typed.takerAmount.toString(),
      side: params.side,
      signatureType: typed.signatureType,
      timestamp: typed.timestamp.toString(),
      metadata: typed.metadata,
      builder: typed.builder,
      expiration: expirationSeconds,
      signature: `0x${signed.signature}`,
    },
    orderType: expirationSeconds === '0' ? 'GTC' : 'GTD',
    typed,
  };
}