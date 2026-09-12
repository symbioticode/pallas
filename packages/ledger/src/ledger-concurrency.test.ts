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

/**
 * PALLAS-M21 — budget de temps EXPLICITE et justifié (pas un contournement).
 *
 * Même raisonnement que la probe M13 : chaque cas lance plusieurs PROCESSUS OS
 * qui enchaînent des appends durables (verrou interprocessus + `fsync` fichier
 * et répertoire via `atomicWriteFileSafe`). Le délai Vitest par défaut (5 s)
 * peut tomber SOUS la latence légitime de l'opération et tuer le test avant le
 * budget d'attente du verrou (`FileLock.timeoutMs` = 10 s). Budget aligné à
 * 30 s, portée inchangée (nombre de processus et d'itérations).
 */
const PROBE_TIMEOUT_MS = 30_000;

/**
 * PALLAS-M21 — extraction du verdict JSON d'une probe, avec diagnostic.
 *
 * Remplace `JSON.parse(stdout.trim().split('\n').pop() ?? '{}')`, qui ne
 * rattrapait PAS la chaîne vide et transformait toute sortie vide en
 * `Unexpected end of JSON input` opaque. Une sortie vide ou non-JSON échoue
 * désormais en NOMMANT la probe et en exposant stdout/stderr.
 */
function probeResult(r: { stdout: string; stderr: string }, label: string): { pid: number } {
  const lines = r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines.length === 0) {
    throw new Error(
      `[${label}] stdout du probe VIDE (aucune ligne écrite) — stderr=${JSON.stringify(r.stderr)}`,
    );
  }
  const last = lines[lines.length - 1]!;
  try {
    return JSON.parse(last) as { pid: number };
  } catch (err) {
    throw new Error(
      `[${label}] stdout du probe non-JSON (${(err as Error).message}) : ` +
        `${JSON.stringify(last)} — stderr=${JSON.stringify(r.stderr)}`,
    );
  }
}

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
    const out1 = probeResult(p1, 'M16/2proc#1');
    const out2 = probeResult(p2, 'M16/2proc#2');
    expect(out1.pid).not.toBe(out2.pid); // vraiment DEUX processus distincts

    const ledger = FileLedger.load(ledgerPath);
    expect(ledger.entries.length).toBe(iterations * 2);
    expect(ledger.verify()).toEqual({ valid: true, brokenAt: null, reason: null });
  }, PROBE_TIMEOUT_MS);

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
  }, PROBE_TIMEOUT_MS);
});
