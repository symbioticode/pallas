/**
 * Ledger d'audit append-only @pallas/ledger — PALLAS-M12.
 *
 * Journal append-only : un enregistrement par décision/trade, avec chaîne de
 * hash SHA-256 :
 *
 *     hash(n) = SHA256( hash(n-1) + contenu(n) )
 *
 * contenu(n) = sérialisation canonique (clés triées) de
 * `{ index, event, timestamp, payload }` — les champs `prev_hash`/`hash` ne
 * font PAS partie du contenu haché. Inspiré de FICHE-LECONS.md point 3 ; la
 * différence clé : AUCUN ancrage on-chain (explicitement hors scope M12).
 *
 * verify() re-vérifie réellement chaque maillon (index séquentiels, chaînage
 * prev_hash, re-hash de chaque contenu) — la propriété d'intégrité est testée
 * et vérifiable, pas seulement générée (mission §6.3). Aucune mutation des
 * enregistrements existants n'est exposée : la classe est append-only par
 * construction (état privé, seule `append`/`appendMany` modifient la liste).
 */

import { createHash } from 'node:crypto';

export interface LedgerRecord {
  index: number;
  event: string;
  /** ISO 8601. */
  timestamp: string;
  payload: unknown;
  /** hex SHA-256 du maillon précédent ; `''` pour index 0. */
  prev_hash: string;
  /** hex SHA-256 de `prev_hash + contenu`. */
  hash: string;
}

export type LedgerEntryInput = Omit<LedgerRecord, 'index' | 'prev_hash' | 'hash'>;

export interface VerifyResult {
  valid: boolean;
  /** Première position qui viole la chaîne (ou null si valide). */
  brokenAt: number | null;
  /** `chain` = lien prev_hash cassé ; `hash` = contenu re-haché ≠ hash stocké ; `index` = index incohérent. */
  reason: 'chain' | 'hash' | 'index' | null;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Sérialisation canonique : clés triées récursivement, zéro espace blanc. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${parts.join(',')}}`;
}

/** Contenu haché d'un enregistrement : index/event/timestamp/payload. */
function contentOf(record: Omit<LedgerRecord, 'hash'>): string {
  return canonicalJson({
    index: record.index,
    event: record.event,
    timestamp: record.timestamp,
    payload: record.payload,
  });
}

/** Re-calcule le hash d'un enregistrement depuis ses champs (hors `hash`). */
export function recomputeRecordHash(record: Omit<LedgerRecord, 'hash'>): string {
  return sha256Hex(`${record.prev_hash}${contentOf(record)}`);
}

/** Journal en mémoire — append-only. La persistance fichier vit dans FileLedger. */
export class Ledger {
  private readonly records: LedgerRecord[] = [];

  /** Copie défensive — aucun appelant ne peut muter les enregistrements internes. */
  get entries(): readonly LedgerRecord[] {
    return this.records.map((r) => structuredClone(r));
  }

  get length(): number {
    return this.records.length;
  }

  append(input: LedgerEntryInput): LedgerRecord {
    const prevHash = this.records.length === 0 ? '' : this.records[this.records.length - 1]!.hash;
    const record: LedgerRecord = {
      index: this.records.length,
      ...input,
      prev_hash: prevHash,
      hash: 'pending',
    };
    record.hash = recomputeRecordHash(record);
    this.records.push(record);
    return structuredClone(record);
  }

  appendMany(inputs: LedgerEntryInput[]): LedgerRecord[] {
    return inputs.map((i) => this.append(i));
  }

  /**
   * Re-vérifie la chaîne complète : index séquentiels, lien prev_hash,
   * re-hash de chaque contenu. Renvoie la première position fautive.
   */
  verify(): VerifyResult {
    for (let i = 0; i < this.records.length; i += 1) {
      const rec = this.records[i]!;
      if (rec.index !== i) {
        return { valid: false, brokenAt: i, reason: 'index' };
      }
      const expectedPrev = i === 0 ? '' : this.records[i - 1]!.hash;
      if (rec.prev_hash !== expectedPrev) {
        return { valid: false, brokenAt: i, reason: 'chain' };
      }
      const recomputed = recomputeRecordHash(rec);
      if (recomputed !== rec.hash) {
        return { valid: false, brokenAt: i, reason: 'hash' };
      }
    }
    return { valid: true, brokenAt: null, reason: null };
  }

  /** Sérialisation pour export/débogage (sans la classe). */
  toJSON(): { root: string; entries: readonly LedgerRecord[] } {
    return { root: 'pallas', entries: this.entries };
  }

  static fromJSON(data: unknown): Ledger {
    const ledger = new Ledger();
    if (typeof data !== 'object' || data === null) return ledger;
    const entries = (data as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return ledger;
    // Les enregistrements charge depuis un fichier sont RO : on reprend les
    // valeurs telles quelles (verify() décidera de leur intégrité).
    for (const e of entries) {
      if (typeof e !== 'object' || e === null) continue;
      const rec = e as LedgerRecord;
      if (typeof rec.index !== 'number' || typeof rec.hash !== 'string') continue;
      ledger.records.push(structuredClone(rec));
    }
    return ledger;
  }
}