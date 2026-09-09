import { test, expect } from 'vitest';
import {
  encryptCredentials,
  decryptCredentials,
  encryptObject,
  decryptObject,
  MissingCredentialKeyError,
  CredentialDecryptError,
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