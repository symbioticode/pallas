/**
 * PALLAS-M13 — DurableStateStore : persistance transactionnelle fail-stop.
 *
 * Vérifie les exigences d'audit §4.5 côté STOCKAGE :
 *  - premier démarrage (fichier absent) ⇒ état neuf LÉGITIME ;
 *  - fichier présent mais illisible (JSON tronqué / schéma / version / type)
 *    ⇒ StateCorruptionError FATAL, jamais de réinitialisation silencieuse ;
 *  - checksum FAUX (falsification) ⇒ StateCorruptionError avant usage ;
 *  - écriture atomique+durable via atomicfs, sous verrou interprocessus.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FileLock } from '@pallas/core';
import { z } from 'zod';

import {
  DurableStateStore,
  StateCorruptionError,
  StateLockError,
  checksumOfState,
  freshState,
  newLifecycle,
  transitionLifecycle,
} from '@pallas/strategy';

function tmpStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pallas-m13-store-'));
  return join(dir, 'risk-state.json');
}

function writeState(file: string, content: string): void {
  writeFileSync(file, content, 'utf8');
}

describe('DurableStateStore — premier démarrage (fichier absent)', () => {
  it('retourne un état neuf légitime', () => {
    const file = tmpStateDir();
    const store = new DurableStateStore(file);
    const doc = store.read();
    expect(doc.version).toBe(2);
    expect(doc.orders).toEqual([]);
    expect(doc.checksum).toBe(checksumOfState(doc.risk, doc.orders, doc.meta));
    expect(existsSync(file)).toBe(false); // la lecture seule ne crée RIEN
  });

  it('`nextCorrelationId` produit un UUID sans collision sur l\'état', () => {
    const store = new DurableStateStore(tmpStateDir());
    const doc = freshState();
    doc.orders.push(newLifecycle({ market_id: 'a', side: 'buy', price: 0.5, quantity: 2, est_value_usd: 1 }));
    const id = store.nextCorrelationId(doc);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(doc.orders.some((o) => o.correlationId === id)).toBe(false);
  });
});

describe('DurableStateStore — corruption = FAIL-STOP catégorique', () => {
  it('JSON tronqué ⇒ StateCorruptionError (jamais d\'état neuf silencieux)', () => {
    const file = tmpStateDir();
    writeState(file, '{"version":2,"checksum":' + 'abc'); // fichier volontairement coupé
    const store = new DurableStateStore(file);
    expect(() => store.read()).toThrow(StateCorruptionError);
    expect(() => store.read()).toThrow(/tronqu/);
  });

  it('fichier vide ⇒ StateCorruptionError', () => {
    const file = tmpStateDir();
    writeState(file, '');
    expect(() => new DurableStateStore(file).read()).toThrow(StateCorruptionError);
  });

  it('JSON non-objet ⇒ StateCorruptionError', () => {
    const file = tmpStateDir();
    writeState(file, '[1,2,3]');
    expect(() => new DurableStateStore(file).read()).toThrow(StateCorruptionError);
  });

  it('mauvaise version ⇒ StateCorruptionError', () => {
    const file = tmpStateDir();
    writeState(file, JSON.stringify({ ...freshState(), version: 1 }));
    expect(() => new DurableStateStore(file).read()).toThrow(StateCorruptionError);
  });

  it('clé inattendue (schéma strict) ⇒ StateCorruptionError', () => {
    const file = tmpStateDir();
    const doc = freshState();
    doc.orders.push(newLifecycle({ market_id: 'm', side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }));
    writeState(file, JSON.stringify({ ...doc, orders: [{ ...doc.orders[0], bogus: 1 }] }));
    expect(() => new DurableStateStore(file).read()).toThrow(StateCorruptionError);
  });

  it('checksum falsifié ⇒ StateCorruptionError AVANT usage de l\'état', () => {
    const file = tmpStateDir();
    const store = new DurableStateStore(file);
    store.write(freshState());
    const tampered = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    (tampered.risk as Record<string, unknown>).hist_pnls = [999]; // falsification silencieuse
    writeState(file, JSON.stringify(tampered));
    expect(() => new DurableStateStore(file).read()).toThrow(StateCorruptionError);
    expect(() => new DurableStateStore(file).read()).toThrow(/checksum/);
  });

  it('état falsifié DANS meta ⇒ StateCorruptionError (le checksum couvre meta)', () => {
    const file = tmpStateDir();
    const store = new DurableStateStore(file);
    store.write(freshState());
    const tampered = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    tampered.meta = { staging: 'injected' };
    writeState(file, JSON.stringify(tampered));
    expect(() => new DurableStateStore(file).read()).toThrow(StateCorruptionError);
  });
});

describe('DurableStateStore — écriture atomique + durabilité', () => {
  it('write produit un fichier lisible, valide et re-checksummé (round-trip)', () => {
    const file = tmpStateDir();
    const store = new DurableStateStore(file);
    const doc = freshState();
    const tx = newLifecycle(
      { market_id: 'mkt', side: 'buy', price: 0.5, quantity: 2, est_value_usd: 1 },
      { correlationId: '11111111-2222-4333-8444-555555555555' },
    );
    doc.orders.push(tx);
    store.write(doc);
    const reread = store.read();
    expect(reread.orders).toHaveLength(1);
    expect(reread.orders[0].correlationId).toBe(tx.correlationId);
    expect(reread.orders[0].status).toBe('DECIDED');
  });

  it('write ne laisse AUCUN fichier temporaire (temp à nom unique + cleanup)', () => {
    const file = tmpStateDir();
    const dir = dirname(file);
    const store = new DurableStateStore(file);
    store.write(freshState());
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600); // état sensible : perms strictes
  });

  it('write remplace l\'état précédent (pas d\'accumulation de duplicats)', () => {
    const file = tmpStateDir();
    const store = new DurableStateStore(file);
    const doc = freshState();
    doc.orders.push(
      newLifecycle(
        { market_id: 'a', side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 },
        { correlationId: '11111111-2222-4333-8444-555555555555' },
      ),
    );
    store.write(doc);
    store.write(doc);
    expect(store.read().orders).toHaveLength(1);
  });
});

describe('DurableStateStore — verrou interprocessus', () => {
  it('un lock tenu par un autre détenteur ⇒ StateLockError au-delà du timeout', async () => {
    const file = tmpStateDir();
    const store = new DurableStateStore(file);
    const holder = new FileLock(file);
    await holder.acquire();
    try {
      const t0 = Date.now();
      await expect(
        store.withLock(() => Promise.resolve(1), { timeoutMs: 150, staleMs: 60_000 }),
      ).rejects.toBeInstanceOf(StateLockError);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    } finally {
      holder.release();
    }
  });

  it('mutation produite par withLock est durable et lisible', async () => {
    const file = tmpStateDir();
    const store = new DurableStateStore(file);
    await store.withLock((doc) => {
      doc.orders.push(
        newLifecycle(
          { market_id: 'm', side: 'sell', price: 0.3, quantity: 5, est_value_usd: 1.5 },
          { correlationId: '11111111-2222-4333-8444-555555555555' },
        ),
      );
      store.write(doc);
    });
    expect(store.read().orders).toHaveLength(1);
  });

  it('withLock relâche TOUJOURS le verrou (même sur erreur)', async () => {
    const file = tmpStateDir();
    const store = new DurableStateStore(file);
    const t0 = Date.now();
    await expect(
      store.withLock(() => {
        throw new Error('boom');
      }, { timeoutMs: 200, staleMs: 60_000 }),
    ).rejects.toThrow('boom');
    // re-acquis immédiatement : si le lock n'avait pas été relâché → timeout.
    await store.withLock(() => Promise.resolve('ok'), { timeoutMs: 200, staleMs: 60_000 });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('DurableStateStore — invariants du modèle d\'état', () => {
  it('freshState() est un doc à jour (version, checksum, breaker fermé)', () => {
    const doc = freshState();
    expect(doc).toMatchObject({ version: 2 });
    expect(doc.risk.circuit_breaker.state).toBe('Closed');
    expect(doc.risk.kill_switch_engaged).toBe(false);
    expect(checksumOfState(doc.risk, doc.orders, doc.meta)).toBe(doc.checksum);
  });

  it('transitionLifecycle NE mute PAS l\'original (immutable)', () => {
    const tx = newLifecycle({ market_id: 'm', side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 });
    const submitted = transitionLifecycle(tx, { status: 'SUBMITTING' });
    expect(tx.status).toBe('DECIDED');
    expect(submitted.status).toBe('SUBMITTING');
    expect(submitted.updated_at >= tx.updated_at).toBe(true);
  });

  it('les status sont bornés par le schéma strict, à l\'ÉCRITURE comme à la lecture', () => {
    const file = tmpStateDir();
    const store = new DurableStateStore(file);
    const doc = freshState();
    doc.orders.push(
      newLifecycle({ market_id: 'm', side: 'buy', price: 0.5, quantity: 1, est_value_usd: 1 }),
    );
    doc.orders[0] = { ...doc.orders[0], status: 'STATUT_ELU' } as never;
    // write() valide AVANT de persister : un statut hors-schéma ne peut pas
    // être durablement accepté (bug de transition ⇒ erreur, pas corruption).
    expect(() => store.write(doc)).toThrow(z.ZodError);
    rmSync(dirname(file), { recursive: true, force: true });
  });
});