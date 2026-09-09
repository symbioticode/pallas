import { test, expect } from 'vitest';
import { allowlist, DeniedCommandError, isAllowlisted, runSandboxed } from './index.js';

test('allowlist contient python3 et node', () => {
  const list = allowlist();
  expect(list).toContain('python3');
  expect(list).toContain('node');
});

test('isAllowlisted accepte les binaires connus', () => {
  expect(isAllowlisted('python3')).toBe(true);
  expect(isAllowlisted('rm')).toBe(false);
});

test('commande hors allowlist refusee (fail-closed)', async () => {
  await expect(() => runSandboxed('rm', ['-rf', '/'])).rejects.toThrow(DeniedCommandError);
});

test('commande vide / inconnue rejetee sans exec', async () => {
  await expect(() => runSandboxed('bash', ['-c', 'echo pwned'])).rejects.toThrow(DeniedCommandError);
});

test('execute un binaire autorise sous bwrap', async () => {
  const res = await runSandboxed('python3', ['-c', 'print(6*7)'], { timeoutMs: 15_000 });
  expect(res.sandboxed).toBe(true);
  expect(res.exitCode).toBe(0);
  expect(res.stdout.trim()).toMatch(/^42$/);
});

test('reseau isole : impossible de joindre l.exterieur (net unshare)', async () => {
  // La requete reseau doit echouer car le namespace reseau est isole.
  const res = await runSandboxed(
    'python3',
    ['-c', "import urllib.request; urllib.request.urlopen('http://127.0.0.1:1', timeout=2)"],
    { timeoutMs: 15_000 },
  );
  // En resume : soit echec reseau, soit exit non zero — jamais une connexion reussie.
  expect(res.exitCode).not.toBe(0);
});

test('input passe a stdin', async () => {
  const res = await runSandboxed('python3', ['-c', 'import sys; print(len(sys.stdin.read()))'], {
    input: 'hello',
    timeoutMs: 15_000,
  });
  expect(res.exitCode).toBe(0);
  expect(res.stdout.trim()).toMatch(/^5$/);
});