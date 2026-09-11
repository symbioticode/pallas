import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Ledger, type LedgerEntryInput, type LedgerRecord, type VerifyResult } from './ledger.js';

/**
 * Persistance SUR FICHIER JSON LOCAL du ledger (PALLAS-M12).
 *
 * LIMITE DÉLIBÉRÉE (documentée, pas un oubli — mission §6.4) : pas de base de
 * données. Un fichier JSON (`{ root, entries }`) est réécrit atomiquement
 * (temp + rename) après chaque append. Adapté au volume de cette mission
 * (quelques enregistrements par session) ; un stockage durable est une piste
 * pour la Phase 3. L'intégrité reste garantie par la chaîne de hash, PAS par
 * le support : un fichier altéré échoue à verify().
 */

export class FileLedger {
  private readonly ledger: Ledger;

  private constructor(
    private readonly path: string,
    existing?: Ledger,
  ) {
    this.ledger = existing ?? new Ledger();
  }

  /** Charge le fichier s'il existe et est JSON ; ledger vide sinon. */
  static load(path: string): FileLedger {
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
      raw = null;
    }
    return new FileLedger(path, Ledger.fromJSON(raw));
  }

  get entries(): readonly LedgerRecord[] {
    return this.ledger.entries;
  }

  get length(): number {
    return this.ledger.length;
  }

  /** Append + écriture atomique du fichier (temp + rename). */
  append(input: LedgerEntryInput): LedgerRecord {
    const rec = this.ledger.append(input);
    this.save();
    return rec;
  }

  appendMany(inputs: LedgerEntryInput[]): LedgerRecord[] {
    const recs = this.ledger.appendMany(inputs);
    this.save();
    return recs;
  }

  verify(): VerifyResult {
    return this.ledger.verify();
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.ledger.toJSON(), null, 2) + '\n', 'utf8');
    renameSync(tmp, resolve(this.path));
  }
}