import { test, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  allowlist,
  BwrapInitError,
  BinaryNotFoundError,
  DeniedCommandError,
  isAllowlisted,
  runSandboxed,
} from './index.js';

afterEach(() => {
  delete process.env.PALLAS_SANDBOX_BIN;
});

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

test('reseau isole : un service du HOST est invisible depuis le sandbox (preuve reelle)', async () => {
  // Un serveur tourne sur la boucle locale du HOST. Depuis le sandbox, le
  // namespace reseau isole ne fournit qu'une `lo` vide : la requete doit
  // echouer avec une exception reseau explicite, et le serveur ne doit
  // recevoir AUCUNE requete. Ce test prouve l'isolation (et non un simple
  // exit != 0), puisque sans isolation la requete aboutirait.
  let received = 0;
  const server = createServer((_req, res) => {
    received += 1;
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  try {
    const res = await runSandboxed(
      'python3',
      ['-c', `import urllib.request; urllib.request.urlopen('http://127.0.0.1:${port}/probe', timeout=3)`],
      { timeoutMs: 15_000 },
    );
    // bwrap doit avoir initialise le sandbox : un 'bwrap: ' dans stderr ici est
    // un ECHEC D'INIT (a detecter comme tel), pas une preuve d'isolation.
    expect(res.stderr).not.toMatch(/(^|\n)\s*bwrap: /);
    expect(res.exitCode).not.toBe(0);
    // L'echec doit etre un echec RESEAU explicite du programme (URLError),
    // pas n'importe quelle sortie non zero.
    expect(res.stderr).toMatch(/URLError|ConnectionRefused|Operation now in progress|timed out|Name or service|Errno/i);
    expect(received).toBe(0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('test negatif : un echec d.INIT bwrap ne peut plus passer pour une isolation reseau', async () => {
  // Simule l'hote de l'audit : bwrap echoue a creer le netns et s'arrete avant
  // de demarrer le programme protege. Fail-closed => runSandboxed REJETTE
  // (BwrapInitError). Un tel echec ne peut donc plus donner de faux positif.
  const dir = mkdtempSync(join(tmpdir(), 'pallas-bwrap-fake-'));
  const fake = join(dir, 'bwrap');
  writeFileSync(
    fake,
    "#!/bin/sh\nprintf 'bwrap: loopback: Failed to create NETLINK_ROUTE socket: Operation not permitted\\n' >&2\nexit 1\n",
  );
  chmodSync(fake, 0o755);
  process.env.PALLAS_SANDBOX_BIN = fake;

  await expect(
    runSandboxed('python3', ['-c', 'print(42)'], { timeoutMs: 15_000 }),
  ).rejects.toThrow(BwrapInitError);
});

test('resolveBinary durei : un binaire non executable dans PATH est rejete', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pallas-path-'));
  mkdirSync(join(dir, 'python3'), { recursive: true }); // un DOSSIER, pas un binaire
  writeFileSync(join(dir, 'python3b'), '#!/bin/sh\necho not-exec\n');
  // 'python3' resolu ne doit PAS etre accepte : ni dossier, ni fichier sans X_OK.
  const prevPath = process.env.PATH;
  process.env.PATH = dir;
  try {
    await expect(() => runSandboxed('python3', ['-c', 'print(42)'], { timeoutMs: 15_000 })).rejects.toThrow(
      BinaryNotFoundError,
    );
  } finally {
    process.env.PATH = prevPath;
  }
});

test('input passe a stdin', async () => {
  const res = await runSandboxed('python3', ['-c', 'import sys; print(len(sys.stdin.read()))'], {
    input: 'hello',
    timeoutMs: 15_000,
  });
  expect(res.exitCode).toBe(0);
  expect(res.stdout.trim()).toMatch(/^5$/);
});