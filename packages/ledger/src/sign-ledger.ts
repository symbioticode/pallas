/**
 * Outil OPÉRATEUR de signature du ledger (PALLAS-M16) — À SÉPARER du process.
 *
 * C'est la SEULE pièce qui touche à la clé PRIVÉE de signature. Elle n'est
 * jamais importée par le run loop (qui ne voit que la clé publique). Usage :
 *
 *   # 1. génération (une fois) d'une paire de clés dans un endroit restreint :
 *   npx tsx packages/ledger/src/sign-ledger.ts gen --dir ~/.pallas-signing
 *   #    → ledger-ed25519.pkcs8.pem (privée, 0600) + ledger-ed25519.spki.pub.pem
 *
 *   # 2. signature PÉRIODIQUE de la tête de chaîne :
 *   npx tsx packages/ledger/src/sign-ledger.ts sign \
 *       --key  ~/.pallas-signing/ledger-ed25519.pkcs8.pem \
 *       --ledger .pallas/ledger.json
 *   #    → écrit .pallas/ledger.json.sig (atomique + fsync)
 *
 * Le run loop lit alors `PALLAS_LEDGER_PUB_KEY` (contain of the SPKI .pem) pour
 * exiger un checkpoint valide au démarrage.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFileSafe } from '@pallas/core';

import { FileLedger } from './file-ledger.js';
import { generateLedgerSigningKeyPair, signLedgerCheckpoint } from './ledger-signing.js';

export const PRIVATE_KEY_FILENAME = 'ledger-ed25519.pkcs8.pem';
export const PUBLIC_KEY_FILENAME = 'ledger-ed25519.spki.pub.pem';

/** Génère PAIRE de clés Ed25519 dans `dir` (privée 0600, jamais `chmod` public). */
export function generateLedgerKeys(dir: string): { privateKeyPath: string; publicKeyPath: string } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pair = generateLedgerSigningKeyPair();
  const privateKeyPath = join(dir, PRIVATE_KEY_FILENAME);
  const publicKeyPath = join(dir, PUBLIC_KEY_FILENAME);
  const privateKeyPem = pair.privateKeyPem.endsWith('\n') ? pair.privateKeyPem : `${pair.privateKeyPem}\n`;
  const publicKeyPem = pair.publicKeyPem.endsWith('\n') ? pair.publicKeyPem : `${pair.publicKeyPem}\n`;
  writeFileSync(privateKeyPath, privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  writeFileSync(publicKeyPath, publicKeyPem, { encoding: 'utf8', mode: 0o644 });
  return { privateKeyPath, publicKeyPath };
}

/**
 * Signe la tête de chaîne d'un ledger et écrit `<ledger>.sig` (atomique +
 * fsync). Vérifie d'abord l'intégrité de la chaîne : on ne signe JAMAIS un
 * ledger corrompu.
 */
export function signLedgerFile(privateKeyPath: string, ledgerPath: string): void {
  const privateKeyPem = readFileSync(privateKeyPath, 'utf8');
  const ledger = FileLedger.load(ledgerPath);
  const { entries } = ledger;
  const checkpoint = signLedgerCheckpoint(privateKeyPem, entries);
  atomicWriteFileSafe(`${ledgerPath}.sig`, JSON.stringify(checkpoint, null, 2) + '\n');
}

/** Lancement CLI (gen | sign). Importé en test sans déclencher main(). */
export function main(argv: string[]): number {
  const [subcommand, ...args] = argv;
  switch (subcommand) {
    case 'gen': {
      const dir = argValue(args, '--dir');
      if (!dir) {
        throw new Error('usage: sign-ledger gen --dir <directory>');
      }
      const { privateKeyPath, publicKeyPath } = generateLedgerKeys(dir);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ event: 'ledger_keys_generated', privateKeyPath, publicKeyPath }));
      return 0;
    }
    case 'sign': {
      const keyPath = argValue(args, '--key');
      const ledgerPath = argValue(args, '--ledger');
      if (!keyPath || !ledgerPath) {
        throw new Error('usage: sign-ledger sign --key <privatePemPath> --ledger <ledgerPath>');
      }
      signLedgerFile(keyPath, ledgerPath);
      console.log(
        JSON.stringify({ event: 'ledger_checkpoint_signed', sigPath: `${ledgerPath}.sig` }),
      );
      return 0;
    }
    default:
      throw new Error(
        `usage: sign-ledger (gen --dir <dir>) | (sign --key <privPem> --ledger <ledgerPath>) — reçu: ${subcommand}`,
      );
  }
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function isEntryPoint(): boolean {
  const invoked = process.argv[1] ?? '';
  return invoked.includes('sign-ledger');
}

if (isEntryPoint()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`sign-ledger: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}