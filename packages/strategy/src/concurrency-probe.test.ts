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

/**
 * PALLAS-M21 — budget de temps EXPLICITE et justifié (pas un contournement).
 *
 * Chaque cas lance plusieurs PROCESSUS OS qui enchaînent des cycles
 * read-modify-write durables : verrou interprocessus, puis `fsync` du fichier +
 * `fsync` du répertoire à chaque écriture (`atomicWriteFileSafe`). Sous
 * contention (jusqu'à 4 processus) sur ce poste (ext4 chiffré LUKS), la durée
 * mesurée du scénario 4 × 3 est p95 ≈ 4,8 s et max ≈ 8,1 s. Le délai par défaut
 * de Vitest (5 s) est INFÉRIEUR au budget d'attente du verrou lui-même
 * (`FileLock.timeoutMs` = 10 s) : le harnais tuait le test avant que la couche
 * verrou ne puisse conclure, produisant un timeout opaque. On aligne le budget
 * du harnais AU-DESSUS de celui du composant testé, sans réduire la portée :
 * nombre de processus et d'itérations inchangés.
 */
const PROBE_TIMEOUT_MS = 30_000;

/**
 * PALLAS-M21 — extraction du verdict JSON d'une probe, avec diagnostic.
 *
 * Remplace `JSON.parse(stdout.trim().split('\n').pop() ?? '{}')` : le `?? '{}'`
 * ne rattrapait PAS la chaîne vide (`split` renvoie toujours ≥ 1 élément), donc
 * une sortie vide devenait un `SyntaxError: Unexpected end of JSON input` sans
 * indication du processus, du flux ni du moment. Ici, une sortie vide ou
 * non-JSON échoue en NOMMANT la probe et en exposant stdout/stderr.
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
    const out1 = probeResult(p1, 'M13/2proc#1');
    const out2 = probeResult(p2, 'M13/2proc#2');
    expect(out1.pid).not.toBe(out2.pid); // vraiment DEUX processus distincts

    const { DurableStateStore } = await import('@pallas/strategy');
    const doc = new DurableStateStore(statePath).read();
    expect(doc.orders).toHaveLength(iterations * 2);
    // aucun doublon d'identifiant
    const ids = doc.orders.map((o) => o.correlationId);
    expect(new Set(ids).size).toBe(ids.length);
  }, PROBE_TIMEOUT_MS);

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
  }, PROBE_TIMEOUT_MS);
});
