/**
 * PALLAS-M16 — concurrence interprocessus sur le ledger : deux writers
 * simultanés ne perdent JAMAIS d'entrée (verrou read-modify-write + écriture
 * atomique). Même protocole que M13 (concurrency-probe.test.ts).
 *
 * N processus node, chacun K appends sur le MÊME fichier : le fichier final
 * doit contenir EXACTEMENT N×K entries avec une chaîne SHA-256 valide.
 */

import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { FileLedger } from './file-ledger.js';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PROBE = join(PROJECT_ROOT, 'scripts', 'ledger-concurrency-probe.mjs');

describe("PALLAS-M16 — concurrence interprocessus (perte d'entrée = échec)", () => {
  it('2 processus × 5 itérations ⇒ exactement 10 entrées, chaîne valide', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-ledger-cc-'));
    const ledgerPath = join(dir, 'ledger.json');
    const iterations = 5;

    const nodeBin = process.execPath;
    const [p1, p2] = await Promise.all([
      execFileAsync(nodeBin, [PROBE, ledgerPath, String(iterations)], { cwd: PROJECT_ROOT }),
      execFileAsync(nodeBin, [PROBE, ledgerPath, String(iterations)], { cwd: PROJECT_ROOT }),
    ]);
    const out1 = JSON.parse(p1.stdout.trim().split('\n').pop() ?? '{}') as { pid: string };
    const out2 = JSON.parse(p2.stdout.trim().split('\n').pop() ?? '{}') as { pid: string };
    expect(out1.pid).not.toBe(out2.pid); // vraiment DEUX processus distincts

    const ledger = FileLedger.load(ledgerPath);
    expect(ledger.entries.length).toBe(iterations * 2);
    expect(ledger.verify()).toEqual({ valid: true, brokenAt: null, reason: null });
  });

  it('4 processus × 3 itérations ⇒ exactement 12 entrées (stress parallèle)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-ledger-cc-'));
    const ledgerPath = join(dir, 'ledger.json');
    const iterations = 3;
    const nodeBin = process.execPath;

    const runs = await Promise.all(
      [0, 1, 2, 3].map(() =>
        execFileAsync(nodeBin, [PROBE, ledgerPath, String(iterations)], { cwd: PROJECT_ROOT }),
      ),
    );
    runs.forEach((r) => expect(r.stderr).toBe(''));

    const ledger = FileLedger.load(ledgerPath);
    expect(ledger.entries.length).toBe(iterations * 4);
    expect(ledger.verify().valid).toBe(true);
  });
});