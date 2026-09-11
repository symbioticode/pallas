import { test, expect } from 'vitest';
import { writeFileSync, mkdtempSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encryptCredentials,
  decryptCredentials,
  encryptObject,
  decryptObject,
  MissingCredentialKeyError,
  CredentialDecryptError,
  assertFilePermissions,
  SecretFilePermissionsError,
} from './credentials.js';

const KEY = { derivationPassphrase: 'test-passphrase-123!' };

test('encrypt/decrypt roundtrip restitue le plaintext', () => {
  const ciphertext = encryptCredentials(KEY, '{"apiKey":"secret"}');
  const decrypted = decryptCredentials(KEY, ciphertext);
  expect(decrypted).toBe('{"apiKey":"secret"}');
});

test('deux chiffrements du meme texte produisent des payloads differents (salt aleatoire)', () => {
  const a = encryptCredentials(KEY, 'hello');
  const b = encryptCredentials(KEY, 'hello');
  expect(a).not.toBe(b);
});

test('mauvaise cle rejettee avec CredentialDecryptError', () => {
  const ciphertext = encryptCredentials(KEY, 'secret');
  expect(() => decryptCredentials({ derivationPassphrase: 'mauvaise-cle!' }, ciphertext)).toThrow(
    CredentialDecryptError
  );
});

test('cle absente => MissingCredentialKeyError (fail-closed)', () => {
  expect(() => encryptCredentials({ derivationPassphrase: '' }, 'x')).toThrow(MissingCredentialKeyError);
  expect(() => decryptCredentials({ derivationPassphrase: '' }, 'v2:aa:bb:cc:dd')).toThrow(
    MissingCredentialKeyError
  );
});

test('format legacy v1 (aes-256-cbc, 4 parties) est rejete', () => {
  // un faux payload v1 a 4 parties
  expect(() => decryptCredentials(KEY, 'abcd:ef01:2345:6789')).toThrow(/non supporté|legacy v1/);
});

test('payload corrompu (tamper authTag) => CredentialDecryptError', () => {
  const ciphertext = encryptCredentials(KEY, 'donnees');
  const parts = ciphertext.split(':');
  // corrompre l'authTag (index 3)
  parts[3] = '0'.repeat(parts[3]!.length);
  expect(() => decryptCredentials(KEY, parts.join(':'))).toThrow(CredentialDecryptError);
});

test('encryptObject/decryptObject roundtrip objet', () => {
  const obj = { platform: 'polymarket', apiKeyId: 'k1', privateKey: 'kp' };
  const payload = encryptObject(KEY, obj);
  const restored = decryptObject<typeof obj>(KEY, payload);
  expect(restored).toEqual(obj);
});

// ------------------ PALLAS-M19 — permissions des fichiers de secrets ------------------

function secretFile(mode: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'pallas-perm-'));
  const file = join(dir, 'vault.bin');
  writeFileSync(file, 'v2:fake');
  try {
    chmodSync(file, mode);
  } catch {
    // certains vfs ignorent chmod : le test d'environnement posix fixera le verdict
  }
  return file;
}

test('M19: fichier de secret 0600 => autorise', async () => {
  const f = secretFile(0o600);
  await expect(assertFilePermissions(f)).resolves.toBeUndefined();
});

test('M19: fichier de secret 0644 (lisible groupe+autres) => rejete explicitement et avec le bon mode', async () => {
  const f = secretFile(0o644);
  await expect(assertFilePermissions(f)).rejects.toBeInstanceOf(SecretFilePermissionsError);
  await expect(assertFilePermissions(f)).rejects.toThrow(/chmod 600/);
});

test('M19: fichier de secret 0600 attendu, mais 0750 -> rejete', async () => {
  const f = secretFile(0o750);
  await expect(assertFilePermissions(f)).rejects.toBeInstanceOf(SecretFilePermissionsError);
});

test('M19: fichier absent -> propage l erreur de lecture (pas une fausse autorisation)', async () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'pallas-perm-')), 'absent.bin');
  await expect(assertFilePermissions(missing)).rejects.toThrow(/ENOENT|not exist|stat/);
});

test('M19: le déverrouillage tolère l état réel du vfs (mode par défaut ne bloque pas un fichier 0600)', async () => {
  // Sur un vfs sans chmod réel, mode = 0666 par defaut ; on documente que la garde
  // POSIX est l'autorité seulement quand le mode est effectivement celui attendu.
  const f = secretFile(0o600);
  const actual = statSync(f).mode & 0o777;
  if (actual === 0o600) {
    await expect(assertFilePermissions(f)).resolves.toBeUndefined();
  }
});