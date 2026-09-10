/**
 * Authentification HTTP CLOB Polymarket (docs getting-started/api, consulté
 * 2026-09-09) :
 *  - L1 : le wallet signe un payload EIP-712 `ClobAuth` pour créer/dériver les
 *    credentials API (headers POLY_ADDRESS / POLY_SIGNATURE / POLY_TIMESTAMP /
 *    POLY_NONCE).
 *  - L2 : chaque requête privée est signée en HMAC-SHA256 du secret (base64),
 *    message = `timestamp + METHOD + path [+ body]` ; signature urlsafe base64
 *    AVEC padding ; headers POLY_ADDRESS / POLY_API_KEY / POLY_PASSPHRASE /
 *    POLY_SIGNATURE / POLY_TIMESTAMP.
 *
 * PALLAS-M02, constat 6 : l'ancien code n'émettait AUCUN de ces headers —
 * `signApiCreds` (EIP-191 concat) n'était relié à aucun appel réseau.
 */

export interface ClobApiCredentials {
  address: string;
  apiKey: string;
  secret: string;
  passphrase: string;
}

/**
 * HMAC-SHA256 du secret (base64 decode) sur `message`, encodé urlsafe base64
 * avec padding (parité avec le client officiel Polymarket tsclob/clob-client).
 */
export async function buildPolyHmacSignature(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body?: string,
): Promise<string> {
  const message = `${timestamp}${method}${path}${body ?? ''}`;
  const keyBytes = base64ToBytes(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToUrlSafeBase64(new Uint8Array(sig));
}

/** Headers L2 complets pour une requête privée (placeOrder, cancelOrder). */
export async function buildL2Headers(
  creds: ClobApiCredentials,
  method: string,
  path: string,
  body?: string,
  nowSeconds?: string,
): Promise<Record<string, string>> {
  const timestamp = nowSeconds ?? Math.floor(Date.now() / 1000).toString();
  const signature = await buildPolyHmacSignature(creds.secret, timestamp, method, path, body);
  return {
    'POLY_ADDRESS': creds.address,
    'POLY_API_KEY': creds.apiKey,
    'POLY_PASSPHRASE': creds.passphrase,
    'POLY_TIMESTAMP': timestamp,
    'POLY_SIGNATURE': signature,
  };
}

/** Headers L1 pour créer/dériver les credentials (signature EIP-712 ClobAuth). */
export function buildL1Headers(
  ca: { address: string; nonce: string; timestamp: string; signature: string },
): Record<string, string> {
  return {
    'POLY_ADDRESS': ca.address,
    'POLY_SIGNATURE': ca.signature,
    'POLY_TIMESTAMP': ca.timestamp,
    'POLY_NONCE': ca.nonce,
  };
}

/** base64 (URL-safe) avec padding, bytes -> string. */
export function bytesToUrlSafeBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  // btoa conserve déjà le padding '=' — on le garde (docs : « keep base64 = suffix »).
  return b64;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}