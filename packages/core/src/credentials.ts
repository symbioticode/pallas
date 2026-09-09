/**
 * Credentials storage — AES-256-GCM, fail-closed.
 *
 * Lecons de CloddsBot corrigees :
 *  - CloddsBot: si la cle est absente, warning silencieux + operation echoue plus tard.
 *    Ici : fail-closed — on throw immédiatement au demarrage.
 *  - CloddsBot: clearance v1 (aes-256-cbc) supportee => migration jamais terminee.
 *    Ici : un seul format v2, pas de legacy.
 *  - CloddsBot: cle privée lue et jamais zeroée en memoire.
 *    Ici : zeroing memoire apres usage (Buffer.fill(0)).
 */

import * as crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION_PREFIX = 'v2';
const KEY_LEN = 32; // 256 bits
const SALT_LEN = 16;
const IV_LEN = 12;

/** Clé de chiffrement passée de facon explicite (injectée), pas lue en globale. */
export interface CredentialKey {
  /** 32 octets utilisés pour scrypt (caller responsable du zeroing). */
  derivationPassphrase: string;
}

export interface EncryptedPayload {
  salt: string; // hex
  iv: string; // hex
  authTag: string; // hex
  ciphertext: string; // hex
}

export class MissingCredentialKeyError extends Error {
  constructor() {
    super(
      'FATAL: la cle de chiffrement des credentials est absente. ' +
        'Générer une passphrase avec: openssl rand -hex 32 et la fournir.'
    );
    this.name = 'MissingCredentialKeyError';
  }
}

export class CredentialDecryptError extends Error {
  constructor(cause: unknown) {
    super('Echec de dechiffrement des credentials (cle invalide ou donnee corrompue).');
    this.name = 'CredentialDecryptError';
    this.cause = cause;
  }
}

/** Dérive une cle 256-bit depuis la passphrase avec scrypt (KDF mémoire-dur). */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, KEY_LEN);
}

/**
 * Chiffre un blob de credentials.
 *
 * @param key - objet portant la passphrase de dérivation
 * @param plaintext - JSON stringifie des credentials
 * @returns payload chiffré versionné au format "v2:salt:iv:authTag:ciphertext"
 */
export function encryptCredentials(key: CredentialKey, plaintext: string): string {
  if (!key.derivationPassphrase || key.derivationPassphrase.length === 0) {
    throw new MissingCredentialKeyError();
  }
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const derived = deriveKey(key.derivationPassphrase, salt);
  const cipher = crypto.createCipheriv(ALGORITHM, derived, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Nettoye immédiatement la cle dérivée apres usage.
  derived.fill(0);
  return [
    VERSION_PREFIX,
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

/**
 * Déchiffre un payload chiffré par `encryptCredentials`.
 *
 * @param key - objet portant la passphrase
 * @param payload - chaîne chiffrée formatée
 * @returns le plaintext JSON
 */
export function decryptCredentials(key: CredentialKey, payload: string): string {
  if (!key.derivationPassphrase || key.derivationPassphrase.length === 0) {
    throw new MissingCredentialKeyError();
  }
  const parts = payload.split(':');
  // On rejette le format legacy v1 (aes-256-cbc) volontairement.
  if (parts[0] !== VERSION_PREFIX || parts.length !== 5) {
    throw new Error('Format de credentials non supporté (legacy v1 rejeté). Ré-chiffrer avec v2.');
  }
  const [, saltHex, ivHex, authTagHex, ciphertextHex] = parts;
  const salt = Buffer.from(saltHex!, 'hex');
  const iv = Buffer.from(ivHex!, 'hex');
  const authTag = Buffer.from(authTagHex!, 'hex');
  const ciphertext = Buffer.from(ciphertextHex!, 'hex');
  const derived = deriveKey(key.derivationPassphrase, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, derived, iv);
  decipher.setAuthTag(authTag);
  derived.fill(0);
  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const cleaned = decrypted.toString('utf8');
    decrypted.fill(0);
    return cleaned;
  } catch (err) {
    throw new CredentialDecryptError(err);
  }
}

/**
 * Wrapper JSON : chiffre un objet credentials, déchiffre en objet.
 */
export function encryptObject<T>(key: CredentialKey, obj: T): string {
  return encryptCredentials(key, JSON.stringify(obj));
}

export function decryptObject<T>(key: CredentialKey, payload: string): T {
  const plaintext = decryptCredentials(key, payload);
  const parsed = JSON.parse(plaintext) as T;
  // JSON.parse copie la string en memoire; on zeroe le buffer d'origine.
  return parsed;
}
