#!/usr/bin/env node
/**
 * PALLAS-M13 — probe de CONCURRENCE interprocessus sur l'état durable.
 *
 * Usage (depuis la racine du repo, après `npm run build`) :
 *   node scripts/durable-state-concurrency-probe.mjs <statePath> <iterations>
 *
 * Chaque invocation IMPORTE le même store (dist de @pallas/strategy) et, à
 * chaque itération, fait la séquence atomique qui doit être visuellement d'une
 * seule pièce :
 *
 *   withLock( read → push(newLifecycle) → write )        // N fois
 *
 * Deux (ou plus) processus exécutés en parallèle sur le même fichier ne doivent
 * jamais se marcher dessus : si le verrou ne protégeait pas le read-modify-write,
 * le dernier écrivain écraserait les cycles de vie de l'autre et la somme finale
 * ne serait pas iterations×2. Après la fin de tous les processus, le test lit
 * l'état et exige iterations×2 cycles de vie — sinon perte d'écriture.
 */

import { DurableStateStore, newLifecycle } from '@pallas/strategy';

const [, , statePath, iterationsRaw] = process.argv;
if (!statePath || !iterationsRaw) {
  console.error('usage: node scripts/durable-state-concurrency-probe.mjs <statePath> <iterations>');
  process.exit(2);
}
const iterations = Number(iterationsRaw);

const store = new DurableStateStore(statePath);

let n = 0;
for (let i = 0; i < iterations; i += 1) {
  n = await store.withLock((doc) => {
    doc.orders.push(
      newLifecycle({
        market_id: `m${process.argv[2].length}-${process.pid}-${i}`,
        side: 'buy',
        price: 0.5,
        quantity: 1,
        est_value_usd: 1,
      }),
    );
    store.write(doc);
    return doc.orders.length;
  });
}

console.log(JSON.stringify({ pid: process.pid, iterations, orders_after_my_turn: n }));