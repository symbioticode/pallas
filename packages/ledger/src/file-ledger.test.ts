/**
 * PALLAS-M16 — FileLedger FAIL-STOP : chargement vérifié, distinction
 * premier-démarrage vs fichier invalide, signature de tête (clé séparée),
 * falsification par recalcul détectée, append durable sous verrou.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FileLedger,
  LedgerIntegrityError,
  LedgerLoadError,
  ledgerCheckpointPath,
} from './file-ledger.js';
import { generateLedgerSigningKeyPair, signLedgerCheckpoint } from './ledger-signing.js';
import { Ledger, recomputeRecordHash, type LedgerRecord } from './ledger.js';
import { signLedgerFile } from './sign-ledger.js';

const T0 = '2026-09-11T10:00:00.000Z';

/** Répertoire temporaire par test ; contient ledger.json (+ .sig) et key.pem. */
function tempEnv(): { dir: string; path: string; keyPath: string; publicKeyPem: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pallas-m16-'));
  const keys = generateLedgerSigningKeyPair();
  const keyPath = join(dir, 'key.pem');
  writeFileSync(keyPath, keys.privateKeyPem, { mode: 0o600 });
  return { dir, path: join(dir, 'ledger.json'), keyPath, publicKeyPem: keys.publicKeyPem };
}

/** Falsification complète réalisée par un ATTAQUANT avec accès au seul fichier :
 * modifie le contenu d'un maillon intermédiaire ET recalcule TOUTE la chaîne
 * (hashes ET liens prev_hash) avec les fonctions exportées — verify() passerait. */
function forgeChainAndRecalculate(doc: { root: string; entries: LedgerRecord[] }): void {
  doc.entries[1]!.payload = { n: 999, hacked: true };
  for (let i = 0; i < doc.entries.length; i += 1) {
    const rec = doc.entries[i]!;
    if (i > 0) rec.prev_hash = doc.entries[i - 1]!.hash;
    rec.hash = recomputeRecordHash(rec);
  }
}

describe('M16: chargement fail-stop — trois cas distincts', () => {
  it('fichier ABSENT au tout premier demarrage -> ledger vide legitime (pas de throw)', () => {
    const env = tempEnv();
    const fl = FileLedger.load(env.path);
    expect(fl.entries.length).toBe(0);
    expect(fl.isSigned).toBe(false);
    expect(fl.verify().valid).toBe(true);
    rmSync(env.dir, { recursive: true, force: true });
  });

  it('fichier ABSENT mais checkpoint .sig present -> LedgerIntegrityError (ledger supprime)', async () => {
    const env = tempEnv();
    const fl = FileLedger.load(env.path);
    await fl.append({ event: 'a', timestamp: T0, payload: { v: 1 } });
    writeFileSync(`${env.path}.sig`, JSON.stringify({ version: 1 }), 'utf8');
    rmSync(env.path);
    expect(() => FileLedger.load(env.path)).toThrow(LedgerIntegrityError);
    rmSync(env.dir, { recursive: true, force: true });
  });

  it('fichier PRESENT mais JSON invalide/tronque -> LedgerLoadError (fatal distinct)', () => {
    const env = tempEnv();
    writeFileSync(env.path, '{ broken', 'utf8');
    expect(() => FileLedger.load(env.path)).toThrow(LedgerLoadError);
    rmSync(env.dir, { recursive: true, force: true });
  });

  it('fichier PRESENT mais structure hors contrat -> LedgerLoadError', () => {
    const env = tempEnv();
    for (const raw of [
      '{}',
      '{"root":"other","entries":[]}',
      '{"root":"pallas","entries":"nope"}',
      '{"root":"pallas","entries":[42]}',
    ]) {
      writeFileSync(env.path, raw, 'utf8');
      expect(() => FileLedger.load(env.path), `raw: ${raw}`).toThrow(LedgerLoadError);
    }
    rmSync(env.dir, { recursive: true, force: true });
  });

  it('rupture de chaine au chargement -> LedgerIntegrityError (jamais silencieuse)', async () => {
    const env = tempEnv();
    const fl = FileLedger.load(env.path);
    await fl.append({ event: 'a', timestamp: T0, payload: { v: 1 } });
    await fl.append({ event: 'b', timestamp: T0, payload: { v: 2 } });
    await fl.append({ event: 'c', timestamp: T0, payload: { v: 3 } });

    // on modifie le payload SANS recalculer (la détection chaine M12 se déclenche)
    const doc = JSON.parse(readFileSync(env.path, 'utf8')) as { entries: LedgerRecord[] };
    doc.entries[1]!.payload = { v: 999 };
    writeFileSync(env.path, JSON.stringify(doc), 'utf8');

    expect(() => FileLedger.load(env.path)).toThrow(LedgerIntegrityError);
    expect(() => FileLedger.load(env.path)).toThrow(/rupture de chaîne/);
    rmSync(env.dir, { recursive: true, force: true });
  });
});

describe('M16: falsification par recalcul détectée par la signature (clé séparée)', () => {
  it('critere 1 : modifier + recalculer avec la fonction exportee -> la signature détecte', async () => {
    const env = tempEnv();
    const fl = FileLedger.load(env.path);
    await fl.append({ event: 'signal', timestamp: T0, payload: { tokenId: 't1', price: 0.5 } });
    await fl.append({ event: 'risk_decision', timestamp: T0, payload: { allowed: true } });
    await fl.append({ event: 'execution', timestamp: T0, payload: { status: 'dry_run_blocked' } });
    await fl.append({ event: 'ledger_verify', timestamp: T0, payload: { ok: true } });

    // 1. l'opérateur signe la tête de chaîne validE (voie normale)
    signLedgerFile(env.keyPath, env.path);
    expect(FileLedger.load(env.path, { publicKeyPem: env.publicKeyPem }).isSigned).toBe(true);

    // 2. l'ATTAQUANT modifie un maillon PUIS recalcule toute la chaîne
    //    (hashes ET pré-chaînage) — c'est le scénario de l'audit v0.3.
    const doc = JSON.parse(readFileSync(env.path, 'utf8')) as { root: string; entries: LedgerRecord[] };
    forgeChainAndRecalculate(doc);
    writeFileSync(env.path, JSON.stringify(doc), 'utf8');

    // vérification vulnérable : le chaînage SHA-256 réécrit est localement
    // valide — un simple verify() (ce que permettait M12) est contourné.
    expect(Ledger.fromJSON(doc).verify().valid).toBe(true);
    // vérification réelle : la signature de tête (clé hors du process) détecte
    // que la chaîne ne contient plus la tête ancrée → démarrage refusé.
    expect(() => FileLedger.load(env.path, { publicKeyPem: env.publicKeyPem })).toThrow(
      LedgerIntegrityError,
    );
    // même sans clé publique configurée, un checkpoint présent est un ancrage :
    // la réécriture ne repasse pas non plus (prefix-anchor).
    expect(() => FileLedger.load(env.path)).toThrow(LedgerIntegrityError);
    rmSync(env.dir, { recursive: true, force: true });
  });

  it('troncature de la chaîne après signature -> détectée (le maillon signé a disparu)', async () => {
    const env = tempEnv();
    const fl = FileLedger.load(env.path);
    await fl.append({ event: 'a', timestamp: T0, payload: { v: 1 } });
    await fl.append({ event: 'b', timestamp: T0, payload: { v: 2 } });
    await fl.append({ event: 'c', timestamp: T0, payload: { v: 3 } });
    signLedgerFile(env.keyPath, env.path);

    const doc = JSON.parse(readFileSync(env.path, 'utf8')) as { entries: LedgerRecord[] };
    doc.entries = doc.entries.slice(0, 1); // on jette les maillons 1..2
    writeFileSync(env.path, JSON.stringify({ root: 'pallas', entries: doc.entries }), 'utf8');

    expect(() => FileLedger.load(env.path, { publicKeyPem: env.publicKeyPem })).toThrow(
      LedgerIntegrityError,
    );
    rmSync(env.dir, { recursive: true, force: true });
  });

  it('append APRES signature (chaîne qui s étend) -> toujours valide au chargement', async () => {
    const env = tempEnv();
    const fl = FileLedger.load(env.path);
    await fl.append({ event: 'a', timestamp: T0, payload: { v: 1 } });
    await fl.append({ event: 'b', timestamp: T0, payload: { v: 2 } });
    signLedgerFile(env.keyPath, env.path);
    // le run continue : de nouvelles entrées s'ajoutent APRÈS le checkpoint
    await fl.append({ event: 'c', timestamp: T0, payload: { v: 3 } });

    expect(() => FileLedger.load(env.path, { publicKeyPem: env.publicKeyPem })).not.toThrow();
    expect(FileLedger.load(env.path, { publicKeyPem: env.publicKeyPem }).verify().valid).toBe(true);
    rmSync(env.dir, { recursive: true, force: true });
  });

  it('mode strict : clé publique configurée mais aucun checkpoint -> refus de démarrer', () => {
    const env = tempEnv();
    expect(() => FileLedger.load(env.path, { publicKeyPem: env.publicKeyPem })).toThrow(
      LedgerIntegrityError,
    );
    expect(() => FileLedger.load(env.path, { publicKeyPem: env.publicKeyPem })).toThrow(
      /absent ou illisible/,
    );
    rmSync(env.dir, { recursive: true, force: true });
  });

  it('checkpoint present mais structure invalide -> LedgerIntegrityError', async () => {
    const env = tempEnv();
    const fl = FileLedger.load(env.path);
    await fl.append({ event: 'a', timestamp: T0, payload: { v: 1 } });
    writeFileSync(`${env.path}.sig`, '{ not-json', 'utf8');
    expect(() => FileLedger.load(env.path, { publicKeyPem: env.publicKeyPem })).toThrow(
      LedgerIntegrityError,
    );
    rmSync(env.dir, { recursive: true, force: true });
  });

  it('checkpoint signé par une AUTRE clé -> signature invalide', async () => {
    const env = tempEnv();
    const otherKeys = generateLedgerSigningKeyPair();
    const fl = FileLedger.load(env.path);
    await fl.append({ event: 'a', timestamp: T0, payload: { v: 1 } });
    await fl.append({ event: 'b', timestamp: T0, payload: { v: 2 } });

    // signé avec la clé de l'outil, vérifié avec une clé DIFFÉRENTE
    const checkpoint = signLedgerCheckpoint(otherKeys.privateKeyPem, fl.entries);
    writeFileSync(ledgerCheckpointPath(env.path), JSON.stringify(checkpoint), 'utf8');

    expect(() => FileLedger.load(env.path, { publicKeyPem: env.publicKeyPem })).toThrow(
      LedgerIntegrityError,
    );
    rmSync(env.dir, { recursive: true, force: true });
  });
});

describe('M16: append sous verrou — durable et frais', () => {
  it('append re-lit le fichier à l état frais sous verrou (src de vérité = fichier)', async () => {
    const env = tempEnv();
    const w1 = FileLedger.load(env.path);
    const w2 = FileLedger.load(env.path);
    await w1.append({ event: 'x', timestamp: T0, payload: { n: 1 } });
    await w1.appendMany([
      { event: 'y', timestamp: T0, payload: { n: 2 } },
      { event: 'z', timestamp: T0, payload: { n: 3 } },
    ]);
    await w2.append({ event: 'w', timestamp: T0, payload: { n: 4 } });
    // w2 a relu le fichier contenant x,y,z avant d'ajouter w : rien n'est perdu.
    expect(FileLedger.load(env.path).verify().valid).toBe(true);
    expect(FileLedger.load(env.path).entries.map((e) => e.event)).toEqual(['x', 'y', 'z', 'w']);
    expect(w1.entries.length).toBe(3); // w1 en mémoire est à son propre point d'écriture
    expect(w2.entries.length).toBe(4);
    rmSync(env.dir, { recursive: true, force: true });
  });
});