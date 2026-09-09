/**
 * Signature CLOB Polymarket — EIP-712 (order) + EIP-191 (api creds).
 *
 * IMPORTANT : le schéma EIP-712 ci-dessous (domain et structure Order) suit la
 * documentation CLOB Polymarket a date. Il DOIT etre valide contre l'API live
 * avant d'autoriser la production d'ordres signes : voir `SIGNATURE_SCHEMA_VALIDATED`
 * dans le client — tant que ce flag n'est pas passe a true, aucun ordre signe
 * n'est emis (fail-closed).
 *
 * Crypto 100% pure JS (@noble) : secp256k1 (RFC6979), keccak256.
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

type RecoverSignature = (
  signature: Uint8Array,
  message: Uint8Array
) => Uint8Array;

// noble 1.x ne type pas recoverPublicKey sur le module `secp256k1` (gap de typages)
const recoverStatic = secp256k1 as unknown as { recoverPublicKey: RecoverSignature };

/** Domain EIP-712 polymarket (documente). A re-valider en live si besoin. */
export const POLYMARKET_DOMAIN = {
  name: 'Polymarket CTF Exchange',
  version: '1',
  chainId: 137n,
  verifyingContract: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
} as const;

/** Structure EIP-712 de l'ordre CLOB (champs atomiques). */
export const POLYMARKET_ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'makerAmount', type: 'uint256' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'expiration', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'feeRateBps', type: 'uint256' },
    { name: 'signatureType', type: 'uint8' },
  ],
} as const;

export interface OrderToSign {
  salt: bigint;
  maker: string;
  signer: string;
  taker: string;
  tokenId: bigint;
  makerAmount: bigint;
  takerAmount: bigint;
  expiration: bigint;
  nonce: bigint;
  feeRateBps: bigint;
  signatureType: number;
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

function toBytesU8(v: number): Uint8Array {
  return toBytesUint(v).slice(31);
}

/** Encodage de type EIP-712 (plat, champs atomiques). */
export function encodeOrderType(types = POLYMARKET_ORDER_TYPES.Order): string {
  const fields = types.map((f) => `${f.name} ${f.type}`).join(',');
  return `Order(${fields})`;
}

/** typeHash = keccak(encodeType) */
export function orderTypeHash(): Uint8Array {
  return keccak(utf8(encodeOrderType()));
}

/** domainSeparator = keccak(encodeData(EIP712Domain)). */
export function domainSeparator(domain = POLYMARKET_DOMAIN): Uint8Array {
  const nameHash = keccak(utf8(domain.name));
  const versionHash = keccak(utf8(domain.version));
  const chain = toBytesUint(domain.chainId);
  const contract = toBytesAddress(domain.verifyingContract);
  return keccak(nameHash, versionHash, chain, contract);
}

/** hashStruct d'un ordre : keccak(typeHash || encodeData(flat, atomique)). */
export function orderStructHash(order: OrderToSign): Uint8Array {
  const data = [
    orderTypeHash(),
    toBytesUint(order.salt),
    toBytesAddress(order.maker),
    toBytesAddress(order.signer),
    toBytesAddress(order.taker),
    toBytesUint(order.tokenId),
    toBytesUint(order.makerAmount),
    toBytesUint(order.takerAmount),
    toBytesUint(order.expiration),
    toBytesUint(order.nonce),
    toBytesUint(order.feeRateBps),
    toBytesU8(order.signatureType),
  ];
  return keccak(...data);
}

/** Digest final EIP-712 : keccak(0x19 0x01 || domainSeparator || structHash). */
export function orderDigest(order: OrderToSign, domain = POLYMARKET_DOMAIN): Uint8Array {
  return keccak(new Uint8Array([0x19, 0x01]), domainSeparator(domain), orderStructHash(order));
}

/** Dérive l'adresse Ethereum depuis une clé privée (hex ou Uint8Array). */
export function privateKeyToAddress(privKey: Uint8Array | string): string {
  const pk = typeof privKey === 'string' ? Buffer.from(privKey.replace(/^0x/i, ''), 'hex') : privKey;
  const pub = secp256k1.getPublicKey(pk, false); // 65 octets [0x04, x, y]
  const hash = keccak_256(pub.slice(1));
  const addr = hash.slice(-20);
  return '0x' + Buffer.from(addr).toString('hex');
}

/**
 * Signe un ordre CLOB (EIP-712). Signature r||s||v(27+recovery), hex sans 0x.
 */
export function signOrder(order: OrderToSign, privKey: Uint8Array | string): SignedOrder {
  const digest = orderDigest(order);
  const sig = secp256k1.sign(digest, typeof privKey === 'string' ? Buffer.from(privKey.replace(/^0x/i, ''), 'hex') : privKey);
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

// ------------------ credentials API (EIP-191 personal_sign) ------------------

/**
 * Signature personnelle EIP-191 : keccak("\x19Ethereum Signed Message:\n" + len + msg).
 * Utilisée pour les api creds (ni keys, timestamp, nonce).
 */
export function signEip191(message: string, privKey: Uint8Array | string): string {
  const prefix = utf8(`\u0019Ethereum Signed Message:\n${message.length}`);
  const digest = keccak(prefix, utf8(message));
  const pk = typeof privKey === 'string' ? Buffer.from(privKey.replace(/^0x/i, ''), 'hex') : privKey;
  const sig = secp256k1.sign(digest, pk);
  const recovery = sig.recovery;
  if (recovery === undefined) throw new Error('signature sans recovery bit');
  return Buffer.concat([Buffer.from(sig.toCompactRawBytes()), Buffer.from([27 + recovery])]).toString('hex');
}

/**
 * Produit le payload api creds attendu par l'API CLOB pour les endpoints prives :
 * { nonce, timestamp, signature }.
 *
 * NOTE : la forme exacte du message signe (concat apiKey+nonce+timestamp) doit
 * etre confirmee contre la doc live avant usage reel — voir flag de validation.
 */
export function signApiCreds(
  apiKey: string,
  nonce: bigint | number,
  timestamp: bigint | number,
  privKey: Uint8Array | string
): { nonce: string; timestamp: string; signature: string } {
  const message = `${apiKey}${nonce.toString()}${timestamp.toString()}`;
  return {
    nonce: nonce.toString(),
    timestamp: timestamp.toString(),
    signature: signEip191(message, privKey),
  };
}

// ------------------ payload d'ordre CLOB signe ------------------

/** Tokens Polymarket : 6 décimales. */
const CLOB_DECIMALS = 1_000_000n;

export interface SignedOrderPayload {
  order: {
    salt: string;
    maker: string;
    signer: string;
    taker: string;
    tokenId: string;
    makerAmount: string;
    takerAmount: string;
    expiration: string;
    nonce: string;
    feeRateBps: string;
    signatureType: number;
  };
  signature: string; // 0x + 65 octets
  owner: string;
  side: 'BUY' | 'SELL';
  price: string;
  size: string;
}

/**
 * Construit le payload d'ordre CLOB signé (EIP-712) depuis des OrderParams.
 *
 * Mtps maker/taker convertis en USDe-6 (`price*size` et `size`). tokenId,
 * maker/taker addresses, taker=zero. **Le schéma et le format wire doivent etre
 * valides contre l'API live avant d'etre utilises (flag signedOrdersValidated).**
 */
export function buildSignedOrderPayload(
  params: { marketId: string; price: number; size: number; side: 'BUY' | 'SELL'; tokenId?: bigint | null },
  signerAddress: string,
  privKey: Uint8Array | string,
  opts: { nonce?: bigint; expiration?: bigint; feeRateBps?: bigint } = {}
): SignedOrderPayload {
  const sizeBig = BigInt(Math.round(params.size * 1_000_000));
  const unitPrice = BigInt(Math.round(params.price * 1_000_000));
  const isBuy = params.side === 'BUY';
  const makerAmount = isBuy ? sizeBig : (sizeBig * unitPrice) / 1_000_000n;
  const takerAmount = isBuy ? (sizeBig * unitPrice) / 1_000_000n : sizeBig;
  const maker = signerAddress.toLowerCase();
  const order: OrderToSign = {
    salt: opts.nonce ?? randomNonce(),
    maker,
    signer: maker,
    taker: '0x0000000000000000000000000000000000000000',
    tokenId: params.tokenId ?? 0n,
    makerAmount,
    takerAmount,
    expiration: opts.expiration ?? BigInt(Math.floor(Date.now() / 1000) + 3600),
    nonce: randomNonce(),
    feeRateBps: opts.feeRateBps ?? 0n,
    signatureType: 1,
  };
  const signed = signOrder(order, privKey);
  return {
    order: {
      salt: order.salt.toString(),
      maker: order.maker,
      signer: order.signer,
      taker: order.taker,
      tokenId: order.tokenId.toString(),
      makerAmount: order.makerAmount.toString(),
      takerAmount: order.takerAmount.toString(),
      expiration: order.expiration.toString(),
      nonce: order.nonce.toString(),
      feeRateBps: order.feeRateBps.toString(),
      signatureType: order.signatureType,
    },
    signature: `0x${signed.signature}`,
    owner: signed.signer,
    side: params.side,
    price: params.price.toFixed(2),
    size: params.size.toString(),
  };
}

function randomNonce(): bigint {
  const bytes = new Uint8Array(16);
  const cryptoObj = globalThis.crypto as unknown as { getRandomValues(a: Uint8Array): void };
  cryptoObj.getRandomValues(bytes);
  return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}