import { test, expect } from 'vitest';
import { writeFileSync, mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encryptPolymarketSecrets,
  decryptPolymarketSecrets,
  loadPolymarketSecrets,
  loadPolymarketSecretsFromFile,
  MissingPolymarketSecretsError,
} from './polymarketSecrets.js';
import { MissingCredentialKeyError, CredentialDecryptError, encryptObject, SecretFilePermissionsError } from '@pallas/core';
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

// ------------------ PALLAS-M19 — loadPolymarketSecretsFromFile ------------------

function vaultFile(mode: number): { path: string; vault: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pallas-vault-'));
  const path = join(dir, 'vault.bin');
  const vault = encryptPolymarketSecrets(PASS, SECRETS);
  writeFileSync(path, vault);
  try { chmodSync(path, mode); } catch { /* vfs may ignore chmod */ }
  return { path, vault, dir };
}

test('M19: loadPolymarketSecretsFromFile autorise un vault 0600 et retourne les secrets', async () => {
  const { path, dir } = vaultFile(0o600);
  const secrets = await loadPolymarketSecretsFromFile(cfg(), path);
  expect(secrets.apiKey).toBe(SECRETS.apiKey);
  expect(secrets.walletPrivateKey).toBe(SECRETS.walletPrivateKey);
});

test('M19: loadPolymarketSecretsFromFile rejette un vault 0644 (permissions trop larges)', async () => {
  const { path } = vaultFile(0o644);
  await expect(loadPolymarketSecretsFromFile(cfg(), path)).rejects.toBeInstanceOf(SecretFilePermissionsError);
});

test('M19: loadPolymarketSecretsFromFile sans cle config rejette avant meme la lecture fichier', async () => {
  const { path } = vaultFile(0o600);
  await expect(loadPolymarketSecretsFromFile(cfg(''), path)).rejects.toBeInstanceOf(MissingCredentialKeyError);
});