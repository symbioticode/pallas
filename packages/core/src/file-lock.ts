/**
 * Verrou interprocessus par répertoire atomique (PALLAS-M13).
 *
 * `mkdir(path.lock)` est atomique en POSIX : si deux processus essaient
 * simultanément, exactement un gagne, l'autre reçoit `EEXIST`. C'est le
 * mécanisme de réglage choisi (pas de dépendance externe, pas de NPM lockfile
 * bugué) — LIMITES connues, documentées (mission §6.3) :
 *   - verrouillage LOCAL uniquement (un PROCESS par fichier d'état) ;
 *   - pas de réentrance (le même process ne doit pas acquérir deux fois
 *     sans relâcher) ; pas distribué — acceptable pour ce stade ;
 *   - un détenteur mort laisse un lock périmé : `staleMs` permet de le
 *     reprendre (le fichier d'état reste valide grâce à son checksum).
 */

import { existsSync, mkdirSync, rmdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface FileLockOptions {
  /** Temps max d'attente du verrou avant échec propre (ms). */
  timeoutMs?: number;
  /** Âge au-delà duquel un lock est considéré périmé (ms). */
  staleMs?: number;
  /** Période de scrutation (ms). */
  retryMs?: number;
}

export class FileLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileLockError';
  }
}

/** Verrou par répertoire pour un fichier cible (lockDir = `<path>.lock`). */
export class FileLock {
  private readonly lockDir: string;
  private readonly timeoutMs: number;
  private readonly staleMs: number;
  private readonly retryMs: number;
  private held = false;

  constructor(targetPath: string, opts: FileLockOptions = {}) {
    this.lockDir = join(resolve(targetPath) + '.lock');
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.staleMs = opts.staleMs ?? 30_000;
    this.retryMs = opts.retryMs ?? 50;
  }

  get lockPath(): string {
    return this.lockDir;
  }

  async acquire(): Promise<void> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      try {
        mkdirSync(this.lockDir);
        this.held = true;
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        if (this.isStale()) {
          // lock laissé par un détenteur mort : on le reprend.
          try {
            rmdirSync(this.lockDir);
          } catch {
            /* course : un autre process vient de le prendre — on retente. */
          }
          continue;
        }
        if (Date.now() >= deadline) {
          throw new FileLockError(
            `lock timeout after ${this.timeoutMs}ms: ${this.lockDir} (un autre process écrit ?)`,
          );
        }
        await new Promise((r) => setTimeout(r, this.retryMs));
      }
    }
  }

  release(): void {
    if (!this.held) return;
    try {
      rmdirSync(this.lockDir);
    } catch {
      /* déjà absent (nettoyage concurrent) — ne pas lever en sortie. */
    }
    this.held = false;
  }

  private isStale(): boolean {
    if (!existsSync(this.lockDir)) return false;
    try {
      const st = statSync(this.lockDir);
      return Date.now() - st.mtimeMs > this.staleMs;
    } catch {
      return false;
    }
  }
}