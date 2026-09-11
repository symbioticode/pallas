#!/usr/bin/env node
/**
 * PALLAS-M16 — probe de CONCURRENCE interprocessus sur l'écriture du ledger.
 *
 * Usage (depuis la racine du repo, après `npm run build`) :
 *   node scripts/ledger-concurrency-probe.mjs <ledgerPath> <iterations>
 *
 * Maille atomique : FileLedger.append (verrou interprocessus + relecture fraîche
 * + écriture atomique/fsync). Deux (ou plus) processus lancés en parallèle sur
 * le même fichier ne doivent JAMAIS perdre d'entrée : sans le verrou, le dernier
 * écrivain écraserait les entries de l'autre et la somme finale serait fausse.
 */

import { FileLedger } from '@pallas/ledger';

const [, , ledgerPath, iterationsRaw] = process.argv;
if (!ledgerPath || !iterationsRaw) {
  console.error('usage: node scripts/ledger-concurrency-probe.mjs <ledgerPath> <iterations>');
  process.exit(2);
}
const iterations = Number(iterationsRaw);

const ledger = FileLedger.load(ledgerPath);

let n = 0;
for (let i = 0; i < iterations; i += 1) {
  await ledger.append({
    event: 'probe',
    timestamp: new Date().toISOString(),
    payload: { pid: process.pid, i },
  });
  n = ledger.length;
}

console.log(JSON.stringify({ pid: process.pid, iterations, entries_after_my_turn: n }));