/**
 * PALLAS-M16 — primitives de signature du ledger (Ed25519, clé séparée) :
 * génération, roundtrip sign/verify, rejet des modifications, refus de signer
 * un ledger vide.
 */

import { describe, expect, it } from 'vitest';

import {
  generateLedgerSigningKeyPair,
  isLedgerCheckpoint,
  signLedgerCheckpoint,
  verifyLedgerCheckpoint,
  checkpointPayload,
} from './ledger-signing.js';
import { Ledger } from './ledger.js';

const T0 = '2026-09-11T10:00:00.000Z';

function threeEntryLedger(): Ledger {
  const ledger = new Ledger();
  ledger.append({ event: 'a', timestamp: T0, payload: { n: 1 } });
  ledger.append({ event: 'b', timestamp: T0, payload: { n: 2 } });
  ledger.append({ event: 'c', timestamp: T0, payload: { n: 3 } });
  return ledger;
}

describe('M16: signature Ed25519 — roundtrip et rejets', () => {
  it('sign -> verify(true) ; le moindre champ du checkpoint l invalide', () => {
    const keys = generateLedgerSigningKeyPair();
    const ledger = threeEntryLedger();
    const cp = signLedgerCheckpoint(keys.privateKeyPem, ledger.entries);

    expect(verifyLedgerCheckpoint(keys.publicKeyPem, cp)).toBe(true);
    expect(isLedgerCheckpoint(cp)).toBe(true);

    // chaque mutation du contenu signé casse la vérification
    const tampered = { ...cp, head_index: cp.head_index + 1 };
    expect(verifyLedgerCheckpoint(keys.publicKeyPem, tampered)).toBe(false);
    const tampered2 = { ...cp, head_hash: cp.head_hash.replace(/^./, '0') };
    expect(verifyLedgerCheckpoint(keys.publicKeyPem, tampered2)).toBe(false);
    const tampered3 = { ...cp, timestamp: '2026-09-11T00:00:00.000Z' };
    expect(verifyLedgerCheckpoint(keys.publicKeyPem, tampered3)).toBe(false);
  });

  it('une autre clé publique rejette la signature', () => {
    const keysA = generateLedgerSigningKeyPair();
    const keysB = generateLedgerSigningKeyPair();
    const ledger = threeEntryLedger();
    const cp = signLedgerCheckpoint(keysA.privateKeyPem, ledger.entries);
    expect(verifyLedgerCheckpoint(keysB.publicKeyPem, cp)).toBe(false);
  });

  it('payload signé = forme canonique déterministe (clés triées, hors signature)', () => {
    const cp = {
      version: 1 as const,
      root: 'pallas',
      head_index: 2,
      head_hash: 'ab'.repeat(32),
      head_event: 'c',
      head_timestamp: T0,
      timestamp: T0,
    };
    expect(checkpointPayload(cp)).toBe(
      '{"head_event":"c","head_hash":"abababababababababababababababababababababababababababababababab","head_index":2,"head_timestamp":"2026-09-11T10:00:00.000Z","root":"pallas","timestamp":"2026-09-11T10:00:00.000Z","version":1}',
    );
  });

  it('refuse de signer un ledger vide (aucune tête à ancrer)', () => {
    const keys = generateLedgerSigningKeyPair();
    expect(() => signLedgerCheckpoint(keys.privateKeyPem, [])).toThrow(/vide/);
  });

  it('isLedgerCheckpoint rejette les formes incomplètes / hors contrat', () => {
    const keys = generateLedgerSigningKeyPair();
    const ledger = threeEntryLedger();
    const cp = signLedgerCheckpoint(keys.privateKeyPem, ledger.entries);
    expect(isLedgerCheckpoint(cp)).toBe(true);
    expect(isLedgerCheckpoint({ ...cp, signature: 42 })).toBe(false);
    expect(isLedgerCheckpoint({ ...cp, root: 'autre' })).toBe(true); // root libre parse
    expect(isLedgerCheckpoint(null)).toBe(false);
    expect(isLedgerCheckpoint('nope')).toBe(false);
  });
});