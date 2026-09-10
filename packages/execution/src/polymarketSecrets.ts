/**
 * Secrets Polymarket — stockage chiffré via @pallas/core, fail-closed.
 *
 * Trois elements sensibles sont geres :
 *   - apiKey / apiSecret   : credentials API CLOB (derives en clé de signature)
 *   - walletPrivateKey     : clé privée du wallet Ethereum/Polygon (secp256k1, signature CLOB)
 *
 * Le vault est chiffré au repos (AES-256-GCM, fail-closed). Au decrypt, les secrets
 * SORTENT EN CLAIR dans un objet JS : ce sont des string non-effaçables, vivantes
 * aussi longtemps que l'objet — en cas de heap dump du process compromis, ils sont
 * recuperables. Aucun zeroing complet possible en JS pur (voir docs/SECURITY.md,
 * PALLAS-M05). Cle absente => MissingCredentialKeyError (fail-closed).
 */

import {
  encryptObject,
  decryptObject,
  MissingCredentialKeyError,
  CredentialDecryptError,
} from '@pallas/core';
import type { AppConfig } from '@pallas/core';

export interface PolymarketSecrets {
  apiKey: string;
  apiSecret: string;
  walletPrivateKey: string;
}

export class MissingPolymarketSecretsError extends Error {
  constructor(missing: readonly string[]) {
    super(`Secrets Polymarket incomplets (absents: ${missing.join(', ')}).`);
    this.name = 'MissingPolymarketSecretsError';
  }
}

/** Vérifie que le payload déchiffré est un jeu de secrets valide (fail-closed). */
function assertValidSecrets(value: unknown): PolymarketSecrets {
  if (value === null || typeof value !== 'object') {
    throw new CredentialDecryptError(new Error('vault degraded non-objet'));
  }
  const rec = value as Record<string, unknown>;
  const missing = (['apiKey', 'apiSecret', 'walletPrivateKey'] as const).filter(
    (f) => typeof rec[f] !== 'string' || (rec[f] as string).length === 0
  );
  if (missing.length > 0) {
    throw new MissingPolymarketSecretsError(missing);
  }
  return {
    apiKey: rec['apiKey'] as string,
    apiSecret: rec['apiSecret'] as string,
    walletPrivateKey: rec['walletPrivateKey'] as string,
  };
}

/** Chiffre un jeu de secrets Polymarket en vault v2. */
export function encryptPolymarketSecrets(passphrase: string, secrets: PolymarketSecrets): string {
  assertValidSecrets(secrets);
  return encryptObject<PolymarketSecrets>({ derivationPassphrase: passphrase }, secrets);
}

/** Déchiffre un vault v2. Cle invalide/corruption => CredentialDecryptError. */
export function decryptPolymarketSecrets(passphrase: string, vault: string): PolymarketSecrets {
  return assertValidSecrets(decryptObject<unknown>({ derivationPassphrase: passphrase }, vault));
}

/**
 * Charge les secrets a partir de la config et d'un vault (contenu du fichier
 * ou valeur d'env PALLAS_VOLUME_CIPHERTEXT). Fail-closed :
 *  - passphrase absente => MissingCredentialKeyError
 *  - vault manquant/illisible => throw
 */
export function loadPolymarketSecrets(config: AppConfig, vaultCiphertext: string): PolymarketSecrets {
  if (!config.credentials.key) {
    throw new MissingCredentialKeyError();
  }
  if (!vaultCiphertext) {
    throw new Error('Vault Polymarket absent : fournir PALLAS_POLYMARKET_VAULT (chiffre v2) en dry-run ou par un gestionnaire de secrets.');
  }
  return decryptPolymarketSecrets(config.credentials.key, vaultCiphertext);
}