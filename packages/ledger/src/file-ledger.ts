/**
 * Persistance SUR FICHIER JSON LOCAL du ledger (PALLAS-M12, durci PALLAS-M16).
 *
 * LIMITE DÉLIBÉRÉE (documentée, pas un oubli) : pas de base de données. Un
 * fichier JSON (`{ root, entries }`) est réécrit atomiquement après chaque
 * append. L'intégrité est garantie par la chaîne de hash (M12) ET par le
 * comportement FAIL-STOP de `load` (M16) : une altération fait refuser le
 * démarrage, jamais un ledger vide silencieux.
 *
 * PALLAS-M16 — ce qui a changé depuis M12 :
 *  - écriture atomique + `fsync` fichier+répertoire via `@pallas/core`
 *    (`atomicfs.ts`) avec nom temporaire UNIQUE, et verrou interprocessus
 *    (`file-lock.ts`) autour de chaque append — le MÊME mécanisme que
 *    PALLAS-M13 pour l'état risk (réutilisé, PAS dupliqué) ;
 *  - vérification OBLIGATOIRE de toute la chaîne au chargement : toute rupture
 *    est FATALE (`LedgerIntegrityError`), distincte du cas "fichier absent au
 *    tout premier démarrage" (légitime, état neuf) et du cas "fichier présent
 *    mais invalide/tronqué" (`LedgerLoadError`, fatal) ;
 *  - vérification de la SIGNATURE DE TÊTE quand un checkpoint `<ledger>.sig`
 *    est présent (`ledger-signing.ts`) : la clé privée vit hors du process
 *    écrivain ; un attaquant qui recalcule la chaîne change le `head_hash` et
 *    la signature ne correspond plus → détecté.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { atomicWriteFileSafe, FileLock, type FileLockOptions } from '@pallas/core';
import { Ledger, type LedgerEntryInput, type LedgerRecord, type VerifyResult } from './ledger.js';
import {
  isLedgerCheckpoint,
  verifyLedgerCheckpoint,
  type LedgerCheckpoint,
} from './ledger-signing.js';

/** Chemin du checkpoint de signature pour un ledger donné : `<ledger>.sig`. */
export function ledgerCheckpointPath(ledgerPath: string): string {
  return `${resolve(ledgerPath)}.sig`;
}

/** Erreur FATALE : fichier PRÉSENT mais illisible/tronqué/JSON invalide. */
export class LedgerLoadError extends Error {
  constructor(reason: string) {
    super(
      `FATAL: fichier ledger présent mais ${reason} — démarrage refusé, ` +
        `jamais de réinitialisation silencieuse. Corriger le fichier ou restaurer une sauvegarde.`,
    );
    this.name = 'LedgerLoadError';
  }
}

/** Erreur FATALE : rupture de chaîne ou signature de tête incohérente. */
export class LedgerIntegrityError extends Error {
  constructor(reason: string) {
    super(`FATAL: intégrité du ledger invalide (${reason}) — démarrage refusé.`);
    this.name = 'LedgerIntegrityError';
  }
}

/** Erreur de verrou : un autre process tient l'écriture du ledger. */
export class LedgerLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerLockError';
  }
}

export interface FileLedgerOptions {
  /**
   * Clé publique Ed25519 (PEM SPKI) pour vérifier le checkpoint `<ledger>.sig`.
   * Si fournie, le checkpoint est OBLIGATOIRE et doit se vérifier cryptographiquement ;
   * sinon le chargement échoue (fail-stop). Si absente, un checkpoint présent est
   * quand même vérifié (cohérence head_index/head_hash) mais un ledger non signé
   * reste accepté (tout premier démarrage légitime, mode dev/unsigned).
   */
  publicKeyPem?: string;
  /** Options du verrou interprocessus (défauts = ceux de @pallas/core). */
  lock?: FileLockOptions;
}

export class FileLedger {
  private constructor(
    private readonly path: string,
    private ledger: Ledger,
    readonly isSigned: boolean,
    private readonly lockOptions: FileLockOptions,
  ) {}

  get entries(): readonly LedgerRecord[] {
    return this.ledger.entries;
  }

  get length(): number {
    return this.ledger.length;
  }

  /**
   * Charge ET vérifie le ledger (PALLAS-M16). Throw fatal sur :
   *  - fichier présent mais JSON invalide/tronqué ou structure hors contrat → `LedgerLoadError` ;
   *  - rupture de chaîne au chargement → `LedgerIntegrityError` ;
   *  - checkpoint `.sig` présent mais illisible, incohérent avec la tête, ou (mode strict
   *    avec clé publique) absent / à signature invalide → `LedgerIntegrityError`.
   *
   * Un fichier ABSENT au tout premier démarrage est le seul cas qui produit un
   * ledger vide légitime (et uniquement si aucun checkpoint `.sig` ne traîne).
   */
  static load(path: string, opts: FileLedgerOptions = {}): FileLedger {
    const resolved = resolve(path);
    const ledger = FileLedger.readChain(resolved);
    const isSigned = FileLedger.verifyHeadCheckpoint(resolved, ledger, opts.publicKeyPem);
    return new FileLedger(resolved, ledger, isSigned, opts.lock ?? {});
  }

  /**
   * Lit le fichier et vérifie SA chaîne (pas la signature — celle-ci n'est
   * vérifiée qu'au `load`). Fichier absent = état neuf légitime. Fichier
   * présent mais invalide = fail-stop.
   */
  private static readChain(path: string): Ledger {
    let rawStr: string;
    try {
      rawStr = readFileSync(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return new Ledger();
      }
      throw err;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(rawStr);
    } catch {
      throw new LedgerLoadError('JSON invalide ou fichier tronqué');
    }
    const ledger = FileLedger.ledgerFromFileDoc(raw);
    const verdict = ledger.verify();
    if (!verdict.valid) {
      throw new LedgerIntegrityError(
        `rupture de chaîne à l'index ${verdict.brokenAt} (${verdict.reason})`,
      );
    }
    return ledger;
  }

  /** Construit un Ledger depuis un document fichier, avec structure stricte. */
  private static ledgerFromFileDoc(raw: unknown): Ledger {
    if (typeof raw !== 'object' || raw === null) {
      throw new LedgerLoadError('structure invalide (objet attendu)');
    }
    const doc = raw as { root?: unknown; entries?: unknown };
    if (doc.root !== 'pallas') {
      throw new LedgerLoadError('racine inattendue (root ≠ "pallas")');
    }
    if (!Array.isArray(doc.entries)) {
      throw new LedgerLoadError('structure invalide (entries non tableau)');
    }
    for (const e of doc.entries) {
      if (typeof e !== 'object' || e === null) {
        throw new LedgerLoadError('enregistrement non-objet dans entries (troncature/corruption)');
      }
    }
    return Ledger.fromJSON(doc);
  }

  /**
   * Vérifie le checkpoint de tête (`<ledger>.sig`) s'il existe — ou s'il est
   * exigé (mode strict). Retourne `true` si un checkpoint valide est présent.
   */
  private static verifyHeadCheckpoint(
    ledgerPath: string,
    ledger: Ledger,
    publicKeyPem?: string,
  ): boolean {
    const cpPath = ledgerCheckpointPath(ledgerPath);
    const [cpRead, checkpoint] = readCheckpointFile(cpPath);

    if (publicKeyPem !== undefined) {
      // Mode strict (clé publique configurée) : checkpoint OBLIGATOIRE.
      if (!checkpoint) {
        throw new LedgerIntegrityError(
          'clé publique configurée mais checkpoint .sig absent ou illisible — la chaîne est-elle signée ?',
        );
      }
    } else if (cpRead === 'absent') {
      // Pas de clé publique, pas de checkpoint : ledger non signé accepté.
      return false;
    } else if (!checkpoint) {
      throw new LedgerIntegrityError('checkpoint .sig présent mais illisible/invalide');
    }

    // Ancrage PREFIXE : la chaîne courante doit contenir le maillon signé
    // (index + hash identiques). Un ledger honnête continue après le checkpoint
    // (signature PÉRIODIQUE) ; une chaîne tronquée (le maillon signé a disparu)
    // ou réécrite (le hash du maillon a changé) est une falsification.
    const anchor = ledger.entries[checkpoint!.head_index];
    if (!anchor || anchor.hash !== checkpoint!.head_hash) {
      throw new LedgerIntegrityError(
        `la chaîne ne contient plus la tête signée ${checkpoint!.head_index}/${checkpoint!.head_hash} ` +
          '(tronquée ou réécrite après signature ?)',
      );
    }

    if (publicKeyPem !== undefined && !verifyLedgerCheckpoint(publicKeyPem, checkpoint!)) {
      throw new LedgerIntegrityError('signature du checkpoint invalide');
    }
    return true;
  }

  /** Append sous verrou : relit le fichier, appends, ré-écrit durablement. */
  async append(input: LedgerEntryInput): Promise<LedgerRecord> {
    return this.withLock((fresh) => ({ ledger: fresh, result: fresh.append(input) }));
  }

  /** `append` de plusieurs entrées en une seule écriture durable. */
  async appendMany(inputs: LedgerEntryInput[]): Promise<LedgerRecord[]> {
    return this.withLock((fresh) => ({ ledger: fresh, result: fresh.appendMany(inputs) }));
  }

  verify(): VerifyResult {
    return this.ledger.verify();
  }

  /** Lecture-fraîche → mutation → écriture atomique, sous verrou interprocessus. */
  private async withLock<T>(
    fn: (fresh: Ledger) => { ledger: Ledger; result: T },
  ): Promise<T> {
    const lock = new FileLock(this.path, this.lockOptions);
    try {
      await lock.acquire();
    } catch (err) {
      if (err instanceof Error && err.name === 'FileLockError') {
        throw new LedgerLockError(err.message);
      }
      throw err;
    }
    try {
      const fresh = FileLedger.readChain(this.path);
      const { ledger, result } = fn(fresh);
      atomicWriteFileSafe(this.path, JSON.stringify(ledger.toJSON(), null, 2) + '\n');
      this.ledger = ledger;
      return result;
    } finally {
      lock.release();
    }
  }
}

/** Lit le fichier `.sig` ; retourne (état, checkpoint éventuel). */
export function readCheckpointFile(
  checkPointPath: string,
): ['absent' | 'invalid' | 'valid', LedgerCheckpoint | null] {
  let rawStr: string;
  try {
    rawStr = readFileSync(checkPointPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return ['absent', null];
    }
    // Présent mais illisible (permissions, EIO…) : anomalie, pas un "absent".
    return ['invalid', null];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawStr);
  } catch {
    return ['invalid', null];
  }
  if (!isLedgerCheckpoint(raw)) {
    return ['invalid', null];
  }
  return ['valid', raw];
}