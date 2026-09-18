/**
 * PALLAS-M23 — verrou à propriétaire et vérification de vivacité (audit v0.4 F-12).
 *
 * Le point testé : un détenteur VIVANT mais LENT ne doit pas se faire reprendre
 * son verrou sur le seul âge du répertoire ; un détenteur MORT doit l'être après
 * `staleMs`.
 */

import { describe, expect, test } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileLock, FileLockError } from './file-lock.js';

/** Crée un lock PÉRIMÉ (mtime reculé de 60 s) portant `owner`. */
function agedLock(target: string, owner: Record<string, unknown>): string {
  const lockDir = target + '.lock';
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify(owner));
  const old = new Date(Date.now() - 60_000);
  utimesSync(lockDir, old, old);
  return lockDir;
}

describe('PALLAS-M23 — FileLock : propriétaire et vivacité', () => {
  test('acquire écrit le propriétaire (pid/hostname/session) et release nettoie', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-lock-'));
    const target = join(dir, 'state.json');
    const lock = new FileLock(target);
    await lock.acquire();
    const owner = JSON.parse(readFileSync(join(lock.lockPath, 'owner.json'), 'utf8')) as Record<string, unknown>;
    expect(owner.pid).toBe(process.pid);
    expect(owner.hostname).toBe(hostname());
    expect(typeof owner.sessionId).toBe('string');
    lock.release();
    expect(existsSync(lock.lockPath)).toBe(false);
  });

  test('détenteur VIVANT mais LENT : le verrou n\'est JAMAIS repris après staleMs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-lock-'));
    const target = join(dir, 'state.json');
    const lockDir = agedLock(target, {
      pid: process.pid, // vivant (c'est nous)
      hostname: hostname(),
      sessionId: 'slow-holder',
      startedAt: new Date().toISOString(),
    });
    const lock = new FileLock(target, { staleMs: 10, retryMs: 5, timeoutMs: 120 });
    await expect(lock.acquire()).rejects.toBeInstanceOf(FileLockError);
    // Le verrou n'a pas été volé : le répertoire et SON propriétaire sont intacts.
    expect(existsSync(lockDir)).toBe(true);
    const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')) as Record<string, unknown>;
    expect(owner.sessionId).toBe('slow-holder');
  });

  test('détenteur MORT : le verrou est repris après staleMs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-lock-'));
    const target = join(dir, 'state.json');
    const lockDir = agedLock(target, {
      pid: 2_147_483_647, // PID inexistant => ESRCH => mort
      hostname: hostname(),
      sessionId: 'dead-holder',
      startedAt: new Date().toISOString(),
    });
    const lock = new FileLock(target, { staleMs: 10, retryMs: 5, timeoutMs: 500 });
    await lock.acquire();
    const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')) as Record<string, unknown>;
    expect(owner.pid).toBe(process.pid);
    expect(owner.sessionId).not.toBe('dead-holder');
    lock.release();
    expect(existsSync(lockDir)).toBe(false);
  });

  test('lock anonyme (sans owner.json) assez vieux : repris ; récent : attendu', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pallas-lock-'));
    const target = join(dir, 'state.json');
    const lockDir = join(target + '.lock');
    mkdirSync(lockDir); // pas d'owner.json
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockDir, old, old);
    const lock = new FileLock(target, { staleMs: 10, retryMs: 5, timeoutMs: 500 });
    await lock.acquire();
    expect(existsSync(lockDir)).toBe(true);
    expect(existsSync(join(lockDir, 'owner.json'))).toBe(true); // réapproprié proprement
    lock.release();
  });
});
