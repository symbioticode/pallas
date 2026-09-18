/**
 * Verrou interprocessus par répertoire atomique (PALLAS-M13, durci PALLAS-M23).
 *
 * `mkdir(path.lock)` est atomique en POSIX : si deux processus essaient
 * simultanément, exactement un gagne, l'autre reçoit `EEXIST`.
 *
 * PALLAS-M23 (audit v0.4 F-12) — le verrou porte désormais un PROPRIÉTAIRE
 * (`owner.json` : pid, hostname, sessionId, startedAt) et la reprise après
 * `staleMs` VÉRIFIE que le détenteur est réellement mort (signal 0) avant de
 * reprendre. Un détenteur VIVANT mais LENT (validation ou E/S longue) ne peut
 * donc plus se faire voler son verrou sur le seul âge du répertoire — c'était la
 * limite structurelle soulignée par l'audit.
 *
 * LIMITES (documentées, non masquées) :
 *   - verrouillage LOCAL (un seul hôte) : la vivacité par PID n'a de sens que sur
 *     le même hôte. Si `owner.hostname` diffère, on retombe sur le seul critère
 *     d'âge — borne assumée (déploiement mono-machine à ce stade) ;
 *   - pas de réentrance (le même process ne doit pas acquérir deux fois sans
 *     relâcher) ; pas distribué ;
 *   - un détenteur mort laisse un lock périmé : repris après `staleMs` ;
 *   - la reprise d'un lock périmé (unlink + rmdir) n'est pas atomique : deux
 *     repreneurs simultanés peuvent se marcher dessus, mais un seul `mkdir`
 *     final gagne — au pire un repreneur retire le fichier `owner.json` d'un
 *     autre avant que celui-ci ne s'en aperçoive. Fenêtre étroite, déjà
 *     présente avant M23, à fermer par un protocole de bail transactionnel si
 *     le multi-hôte devient un besoin réel.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';

export interface FileLockOptions {
  /** Temps max d'attente du verrou avant échec propre (ms). */
  timeoutMs?: number;
  /** Âge au-delà duquel un lock SANS détenteur vivant est considéré périmé (ms). */
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

/** Propriétaire d'un verrou, persisté dans `<lock>/owner.json`. */
export interface LockOwner {
  pid: number;
  hostname: string;
  /** Identifiant de session du détenteur (diagnostic / reprise). */
  sessionId: string;
  /** ISO 8601 de l'acquisition. */
  startedAt: string;
}

function ownerFilePath(lockDir: string): string {
  return join(lockDir, 'owner.json');
}

function readOwner(lockDir: string): LockOwner | null {
  try {
    const raw = JSON.parse(readFileSync(ownerFilePath(lockDir), 'utf8')) as Partial<LockOwner>;
    if (typeof raw.pid !== 'number' || typeof raw.hostname !== 'string') return null;
    return {
      pid: raw.pid,
      hostname: raw.hostname,
      sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : '',
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
    };
  } catch {
    return null;
  }
}

/** Le processus `pid` est-il vivant sur CET hôte ? `EPERM` = vivant (pas à nous). */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Verrou par répertoire pour un fichier cible (lockDir = `<path>.lock`). */
export class FileLock {
  private readonly lockDir: string;
  private readonly timeoutMs: number;
  private readonly staleMs: number;
  private readonly retryMs: number;
  private readonly sessionId = randomUUID();
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
        try {
          const owner: LockOwner = {
            pid: process.pid,
            hostname: hostname(),
            sessionId: this.sessionId,
            startedAt: new Date().toISOString(),
          };
          writeFileSync(ownerFilePath(this.lockDir), JSON.stringify(owner));
        } catch (err) {
          // Impossible d'écrire le propriétaire : ne pas laisser un lock anonyme.
          this.forceRelease();
          throw err;
        }
        this.held = true;
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        if (this.isStale()) {
          // Détenteur mort (ou lock anonyme assez vieux) : on le reprend.
          this.forceRelease();
          continue;
        }
        if (Date.now() >= deadline) {
          throw new FileLockError(
            `lock timeout after ${this.timeoutMs}ms: ${this.lockDir} (detenteur vivant ou process concurrent)`,
          );
        }
        await new Promise((r) => setTimeout(r, this.retryMs));
      }
    }
  }

  release(): void {
    if (!this.held) return;
    this.forceRelease();
    this.held = false;
  }

  /** Retire le propriétaire PUIS le répertoire (rmdir exige un dossier vide). */
  private forceRelease(): void {
    try {
      unlinkSync(ownerFilePath(this.lockDir));
    } catch {
      /* owner absent : rien à retirer */
    }
    try {
      rmdirSync(this.lockDir);
    } catch {
      /* déjà absent (nettoyage concurrent) — ne pas lever en sortie. */
    }
  }

  /**
   * Le verrou est-il périmé ? PALLAS-M23 : un détenteur VIVANT sur le même hôte
   * n'est JAMAIS périmé, quelle que soit la date du répertoire. Sinon (processus
   * mort, owner illisible, ou hôte différent) on retombe sur le seul âge.
   */
  private isStale(): boolean {
    if (!existsSync(this.lockDir)) return false;
    const owner = readOwner(this.lockDir);
    if (owner && owner.hostname === hostname()) {
      if (pidAlive(owner.pid)) return false; // détenteur VIVANT => jamais repris
    }
    try {
      const st = statSync(this.lockDir);
      return Date.now() - st.mtimeMs > this.staleMs;
    } catch {
      return false;
    }
  }
}
