import { test, expect } from 'vitest';
import {
  encryptPolymarketSecrets,
  decryptPolymarketSecrets,
  loadPolymarketSecrets,
  MissingPolymarketSecretsError,
} from './polymarketSecrets.js';
import { MissingCredentialKeyError, CredentialDecryptError, encryptObject } from '@pallas/core';
import type { AppConfig } from '@pallas/core';

const PASS = 'test-passphrase-123!';
const SECRETS = {
  apiKey: 'api-key-abc',
  apiSecret: 'api-secret-xyz',
  walletPrivateKey: '5Kc8uBvnYkL4EtNcdqQ1Z7mFhxT9pVwA2jR3sD6gH8nJ0mQzWbEi',
};

function cfg(key = PASS): AppConfig {
  return {
    trading: { dryRun: true },
    credentials: { key },
    gateway: { port: 18789, bind: '127.0.0.1', authToken: '', rateLimitPerMinute: 100 },
  };
}

test('roundtrip chiffre/dechiffre rend les secrets a lidentique', () => {
  const vault = encryptPolymarketSecrets(PASS, SECRETS);
  const restored = decryptPolymarketSecrets(PASS, vault);
  expect(restored).toEqual(SECRETS);
});

test('deux chiffrements du meme jeu produisent des vaults differents (salt aleatoire)', () => {
  const a = encryptPolymarketSecrets(PASS, SECRETS);
  const b = encryptPolymarketSecrets(PASS, SECRETS);
  expect(a).not.toBe(b);
});

test('mauvaise passphrase => CredentialDecryptError (fail-closed)', () => {
  const vault = encryptPolymarketSecrets(PASS, SECRETS);
  expect(() => decryptPolymarketSecrets('mauvaise-passphrase', vault)).toThrow(CredentialDecryptError);
});

test('passphrase absente => MissingCredentialKeyError', () => {
  expect(() => encryptPolymarketSecrets('', SECRETS)).toThrow(MissingCredentialKeyError);
  expect(() => decryptPolymarketSecrets('', 'v2:aa:bb:cc:dd')).toThrow(MissingCredentialKeyError);
});

test('vault corrompu (tamper) => CredentialDecryptError', () => {
  const vault = encryptPolymarketSecrets(PASS, SECRETS);
  const parts = vault.split(':');
  parts[3] = '0'.repeat(parts[3]!.length); // corrompre l'authTag
  expect(() => decryptPolymarketSecrets(PASS, parts.join(':'))).toThrow(CredentialDecryptError);
});

test('secrets incomplets => MissingPolymarketSecretsError (fail-closed)', () => {
  expect(() =>
    encryptPolymarketSecrets(PASS, { apiKey: '', apiSecret: 'x', walletPrivateKey: 'y' })
  ).toThrow(MissingPolymarketSecretsError);

  // un vault authentique dont le plaintext serait incomplet est refuse au decrypt
  const partialVault = encryptObject<Record<string, unknown>>(
    { derivationPassphrase: PASS },
    { apiKey: 'k' }
  );
  expect(() => decryptPolymarketSecrets(PASS, partialVault)).toThrow(MissingPolymarketSecretsError);
});

test('loadPolymarketSecrets lit vault via config (passphrase depuis PALLAS_CREDENTIAL_KEY)', () => {
  const vault = encryptPolymarketSecrets(PASS, SECRETS);
  const secrets = loadPolymarketSecrets(cfg(), vault);
  expect(secrets.walletPrivateKey).toBe(SECRETS.walletPrivateKey);
});

test("loadPolymarketSecrets sans cle config => MissingCredentialKeyError; sans vault => throw", () => {
  expect(() => loadPolymarketSecrets(cfg(''), 'v2:aa:bb:cc:dd')).toThrow(MissingCredentialKeyError);
  expect(() => loadPolymarketSecrets(cfg(), '')).toThrow(/Vault Polymarket absent/);
});