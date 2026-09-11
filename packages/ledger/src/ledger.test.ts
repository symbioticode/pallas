import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger, recomputeRecordHash } from './ledger.js';
import { FileLedger } from './file-ledger.js';

const T0 = '2026-09-10T12:00:00.000Z';

/**
 * PALLAS-M12 Partie B : le test de DETECTION DE FALSIFICATION est écrit AVANT
 * l'implémentation complète du ledger (mission §5 Partie B). `ledger.ts` est
 * implémenté pour rendre ce bloc vert — la propriété d'intégrité guide la
 * conception, pas l'inverse.
 */

describe('M12: detection de falsification du ledger', () => {
  // L'attaque réelle passe par la FORME SÉRIALISÉE (le fichier durable) : on
  // exporte le ledger, on altère un enregistrement par index, on ré-importe.
  // L'immutabilité de la classe en mémoire (copie défensive) est testée
  // séparément ; ici on teste ce que verify() détecte face à un contenu altéré.

  it('M12: falsifier un maillon intermediaire -> verify signale son index exact', () => {
    const ledger = new Ledger();
    ledger.append({ event: 'signal', timestamp: T0, payload: { tokenId: 't1', price: 0.5 } });
    ledger.append({ event: 'risk_decision', timestamp: T0, payload: { allowed: true, rejected_by: [] } });
    ledger.append({ event: 'execution', timestamp: T0, payload: { status: 'dry_run_blocked' } });
    ledger.append({ event: 'ledger_verify', timestamp: T0, payload: { ok: true } });

    const serialized = ledger.toJSON();
    const victim = serialized.entries[2] as { payload: Record<string, unknown> };
    victim.payload['status'] = 'PEUT_ETRE_PLACE';

    const tampered = Ledger.fromJSON(serialized);
    const verdict = tampered.verify();
    expect(verdict.valid).toBe(false);
    expect(verdict.brokenAt).toBe(2);
    expect(verdict.reason).toBe('hash');
  });

  it('M12: re-hasher UN SEUL maillon forge ne repare pas la chaine', () => {
    const ledger = new Ledger();
    ledger.append({ event: 'a', timestamp: T0, payload: { n: 1 } });
    ledger.append({ event: 'b', timestamp: T0, payload: { n: 2 } });
    ledger.append({ event: 'c', timestamp: T0, payload: { n: 3 } });

    const serialized = ledger.toJSON();
    const victim = serialized.entries[1] as {
      index: number;
      event: string;
      timestamp: string;
      payload: unknown;
      prev_hash: string;
      hash: string;
    };
    victim.payload = { n: 999 };
    // L'attaquant met a jour le hash du maillon forge a la main…
    victim.hash = recomputeRecordHash(victim);
    // …mais le maillon suivant reference encore l'ancien hash en prev_hash.
    const tampered = Ledger.fromJSON(serialized);

    const verdict = tampered.verify();
    expect(verdict.valid).toBe(false);
    expect(verdict.brokenAt).toBe(2);
    expect(verdict.reason).toBe('chain');
  });

  it('M12: faire pointer la tete vers le mauvais prev buste des index 0', () => {
    const ledger = new Ledger();
    ledger.append({ event: 'x', timestamp: T0, payload: { v: 1 } });
    ledger.append({ event: 'x', timestamp: T0, payload: { v: 2 } });
    ledger.append({ event: 'x', timestamp: T0, payload: { v: 3 } });

    const serialized = ledger.toJSON();
    const head = serialized.entries[0] as { prev_hash: string };
    head.prev_hash = (serialized.entries[1] as { hash: string }).hash;

    const tampered = Ledger.fromJSON(serialized);
    const verdict = tampered.verify();
    expect(verdict.valid).toBe(false);
    expect(verdict.brokenAt).toBe(0);
    expect(verdict.reason).toBe('chain');
  });
});

describe('M12: chaîne valide et proprietes append-only', () => {
  it('M12: chaîne générée proprement -> verify valide, hash(n)=SHA256(hash(n-1)+contenu)', () => {
    const ledger = new Ledger();
    ledger.append({ event: 'signal', timestamp: T0, payload: { tokenId: 't1', price: 0.5 } });
    ledger.append({ event: 'risk_decision', timestamp: T0, payload: { allowed: true, rejected_by: [] } });
    ledger.append({ event: 'execution', timestamp: T0, payload: { status: 'dry_run_blocked' } });

    const verdict = ledger.verify();
    expect(verdict).toEqual({ valid: true, brokenAt: null, reason: null });
    expect(ledger.entries[1]!.prev_hash).toBe(ledger.entries[0]!.hash);
    expect(ledger.entries[2]!.prev_hash).toBe(ledger.entries[1]!.hash);
    // Le hash stocké est bien le re-hash du contenu + prev_hash.
    for (const rec of ledger.entries) {
      expect(recomputeRecordHash(rec)).toBe(rec.hash);
    }
  });

  it('M12: hash déterministe — mêmes entrées -> mêmes hash, indépendant des clés de payload', () => {
    const a = new Ledger();
    const b = new Ledger();
    a.append({ event: 'e', timestamp: T0, payload: { b: 1, a: 2 } });
    b.append({ event: 'e', timestamp: T0, payload: { a: 2, b: 1 } });
    expect(a.entries[0]!.hash).toBe(b.entries[0]!.hash);
  });

  it('M12: append-only — la copie retournée est une copie, pas une reference interne', () => {
    const ledger = new Ledger();
    const rec = ledger.append({ event: 'x', timestamp: T0, payload: { n: 1 } });
    (rec.payload as Record<string, unknown>)['n'] = 999;
    // La mutation sur la copie ne touche pas l'enregistrement interne.
    expect(ledger.entries[0]!.payload).toEqual({ n: 1 });
    expect(ledger.verify().valid).toBe(true);
  });

  it('M12: persistance fichier — roundtrip load/append/verify + écriture atomique', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-ledger-'));
    try {
      const path = join(dir, 'ledger.json');
      const fl = FileLedger.load(path);
      fl.append({ event: 'a', timestamp: T0, payload: { v: 1 } });
      fl.append({ event: 'b', timestamp: T0, payload: { v: 2 } });

      const reloaded = FileLedger.load(path);
      expect(reloaded.length).toBe(2);
      expect(reloaded.verify()).toEqual({ valid: true, brokenAt: null, reason: null });
      expect(reloaded.entries[1]!.prev_hash).toBe(fl.entries[1]!.prev_hash);

      const onDisk = JSON.parse(readFileSync(path, 'utf8')) as { root: string; entries: unknown[] };
      expect(onDisk.root).toBe('pallas');
      expect(Array.isArray(onDisk.entries)).toBe(true);
      expect(existsSync(`${path}.tmp`)).toBe(false); // tmp absent (rename atomique)
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('M12: falsification APRES persistance fichier -> verify detecte au reload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-ledger-'));
    try {
      const path = join(dir, 'ledger.json');
      const fl = FileLedger.load(path);
      fl.append({ event: 'a', timestamp: T0, payload: { v: 1 } });
      fl.append({ event: 'b', timestamp: T0, payload: { v: 2 } });
      fl.append({ event: 'c', timestamp: T0, payload: { v: 3 } });

      // Altération manuelle du fichier (le mode d'attaque du monde réel).
      const doc = JSON.parse(readFileSync(path, 'utf8')) as { entries: Array<{ payload: unknown }> };
      (doc.entries[1]!.payload as Record<string, unknown>)['v'] = 999;
      writeFileSync(path, JSON.stringify(doc), 'utf8');

      expect(FileLedger.load(path).verify().valid).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});