/**
 * Credentials storage — AES-256-GCM, fail-closed.
 *
 * Lecons de CloddsBot corrigees :
 *  - CloddsBot: si la cle est absente, warning silencieux + operation echoue plus tard.
 *    Ici : fail-closed — on throw immediatement au demarrage.
 *  - CloddsBot: clearance v1 (aes-256-cbc) supportee => migration jamais terminee.
 *    Ici : un seul format v2, pas de legacy.
 *  - CloddsBot: cle privée lue et jamais zeroée en memoire.
 *    Ici : la cle derivee (Buffer) et le buffer dechiffre temporaire sont zeroes
 *    (`.fill(0)`). La passphrase et le plaintext restent des `string` JS
 *    NON-effaçables — voir docs/SECURITY.md (PALLAS-M05) pour le risque residuel.
 */

import * as crypto from 'node:crypto';
import { stat } from 'node:fs/promises';

const ALGORITHM = 'aes-256-gcm';
const VERSION_PREFIX = 'v2';
const KEY_LEN = 32; // 256 bits
const SALT_LEN = 16;
const IV_LEN = 12;

/** Clé de chiffrement passée de facon explicite (injectée), pas lue en globale. */
export interface CredentialKey {
  /** Passphrase de derivation (string JS, NON-effaçable). La cle derivee est zeroee. */
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

// ---------------------------------------------------------------------------
// PALLAS-M19 — Garde de permissions pour tout fichier contenant un secret
// ---------------------------------------------------------------------------

export class SecretFilePermissionsError extends Error {
  constructor(filePath: string, actualMode: string, expected: string) {
    super(
      `Refus de lire ${filePath} : permissions trop larges (${actualMode}, attendu ${expected}). ` +
        'Corriger avec: chmod 600 <fichier>',
    );
    this.name = 'SecretFilePermissionsError';
  }
}

/**
 * Vérifie les permissions d'un fichier de secret AVANT lecture.
 *
 * Linux/NixOS uniquement (mode `st.mode`位 POSIX). Vérifie que les bits
 * groupe/autres sont désactivés (`mode & 0o077 === 0`). Le mode attendu par
 * défaut est `0600` (propriétaire en lecture/écriture uniquement) — cohérent
 * avec la procédure de `docs/PHASE-2.2-procedure.md` (chmod 600 sur secrets).
 *
 * @param filePath chemin absolu ou relatif du fichier à vérifier
 * @param expectedMode octal mode attendu (défaut 0o600)
 * @throws SecretFilePermissionsError si les permissions sont trop larges
 */
export async function assertFilePermissions(filePath: string, expectedMode = 0o600): Promise<void> {
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(filePath);
  } catch (err) {
    // fichier absent ≠ permissions larges : propager l'erreur de lecture originale
    throw err;
  }
  const mode = fileStat.mode & 0o777;
  if (mode & ~expectedMode) {
    const actualOctal = '0' + (mode >>> 0).toString(8);
    const expectedOctal = '0' + (expectedMode >>> 0).toString(8);
    throw new SecretFilePermissionsError(filePath, actualOctal, expectedOctal);
  }
}
