/**
 * PALLAS-M13 — concurrence interprocessus : deux writers simultanés ne perdent
 * JAMAIS d'écriture (verrou read-modify-write sur le fichier d'état).
 *
 * Deux processus node, sur le MÊME fichier, chacun N cycles de vie via
 * `DurableStateStore.withLock`. Le fichier final doit contenir EXACTEMENT 2×N
 * cycles — sinon le dernier écrivain aurait écrasé le travail de l'autre.
 */

import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PROBE = join(PROJECT_ROOT, 'scripts', 'durable-state-concurrency-probe.mjs');

describe('PALLAS-M13 — concurrence interprocessus (perte d\'écriture = échec)', () => {
  it('2 processus × 5 itérations ⇒ exactement 10 cycles de vie dans l\'état', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-cc-'));
    const statePath = join(dir, 'risk-state.json');
    const iterations = 5;

    const nodeBin = process.execPath;
    const [p1, p2] = await Promise.all([
      execFileAsync(nodeBin, [PROBE, statePath, String(iterations)], { cwd: PROJECT_ROOT }),
      execFileAsync(nodeBin, [PROBE, statePath, String(iterations)], { cwd: PROJECT_ROOT }),
    ]);
    const out1 = JSON.parse(p1.stdout.trim().split('\n').pop() ?? '{}') as { pid: string };
    const out2 = JSON.parse(p2.stdout.trim().split('\n').pop() ?? '{}') as { pid: string };
    expect(out1.pid).not.toBe(out2.pid); // vraiment DEUX processus distincts

    const { DurableStateStore } = await import('@pallas/strategy');
    const doc = new DurableStateStore(statePath).read();
    expect(doc.orders).toHaveLength(iterations * 2);
    // aucun doublon d'identifiant
    const ids = doc.orders.map((o) => o.correlationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('4 processus × 3 itérations ⇒ exactement 12 cycles (stress parallèle)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-cc-'));
    const statePath = join(dir, 'risk-state.json');
    const iterations = 3;
    const nodeBin = process.execPath;

    const runs = await Promise.all(
      [0, 1, 2, 3].map(() =>
        execFileAsync(nodeBin, [PROBE, statePath, String(iterations)], { cwd: PROJECT_ROOT }),
      ),
    );
    runs.forEach((r) => expect(r.stderr).toBe(''));

    const { DurableStateStore } = await import('@pallas/strategy');
    const doc = new DurableStateStore(statePath).read();
    expect(doc.orders).toHaveLength(iterations * 4);
  });
});