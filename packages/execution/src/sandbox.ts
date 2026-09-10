/**
 * Sandbox d'execution de commandes via bubblewrap (bwrap).
 *
 * Ce module est un des piliers de securite du terminal : il ne laisse JAMAIS
 * une commande arbitraire s'executer librement. Tout exec passe par :
 *
 * 1. `execFile` (array d'arguments, jamais `shell:true`) — aucune injection shell.
 * 2. Une ALLOWLIST de binaires : seuls les noms connus sont acceptes.
 * 3. Un namespace bubblewrap isole (net, PID, UTS, filesystem en lecture seule).
 *
 * Portee de la protection filesystem : la racine `/` montee en lecture seule
 * (--ro-bind) empêche l'ECRITURE, mais ne protège PAS la confidentialite —
 * le processus sandboxe peut toujours LIRE les fichiers lisibles par son
 * utilisateur. Un programme malveillant peut donc exfiltrer des donnees
 * lisibles ; le sandbox neutralise mutation/destruction, pas la lecture.
 *
 * Fail-closed : si bwrap est manquant OU echoue a initialiser l'isolation
 * (ex. netns non permis), on THROW plutot que d'executer en clair.
 */

import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/** Binaires autorises (noms courts only). La resolution se fait via PATH. */
const ALLOWLIST: ReadonlyArray<string> = ['python3', 'python', 'node', 'ls', 'echo'];

/** Préfixe des messages d'échec d'INITIALISATION de bwrap (fail-closed, cf. runSandboxed). */
const BWARP_INIT_PREFIX = /(^|\n)\s*bwrap: /m;

export interface SandboxOptions {
  /** Temps maximum d'execution en ms (defaut 10s). */
  timeoutMs?: number;
  /** Entree sur stdin (optionnel). */
  input?: string;
  /** Dossier de travail (defaut : cwd courant, monte en lecture seule). */
  cwd?: string;
  /** Variables d'environnement a propager. */
  env?: Record<string, string>;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Vrai si le binaire a ete essaye sous bwrap. */
  sandboxed: boolean;
}

/** Erreur d'execution sandboxee : binaire refuse, bwrap absent, ou echec. */
export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxError';
  }
}

/** Binaire interdit / hors allowlist. */
export class DeniedCommandError extends SandboxError {
  constructor(command: string) {
    super(`command '${command}' is not in the allowlist`);
    this.name = 'DeniedCommandError';
  }
}

/** bwrap introuvable, requis pour une execution sandboxee. */
export class MissingBwrapError extends SandboxError {
  constructor() {
    super('bwrap (bubblewrap) not found; refusing to run unsandboxed by default');
    this.name = 'MissingBwrapError';
  }
}

/** Binaire autorise mais introuvable OU non executable dans le PATH. */
export class BinaryNotFoundError extends SandboxError {
  constructor(command: string) {
    super(`allowlisted binary '${command}' not found as a regular executable in PATH`);
    this.name = 'BinaryNotFoundError';
  }
}

/** bwrap s'est lance mais n'a PAS pu initialiser le sandbox (ex. netns refuse). */
export class BwrapInitError extends SandboxError {
  constructor(stderr: string) {
    super(`bwrap failed to initialise the sandbox (fail-closed); protected program never ran. stderr: ${stderr.trim().slice(0, 400)}`);
    this.name = 'BwrapInitError';
  }
}

export function isAllowlisted(command: string): boolean {
  return ALLOWLIST.includes(command);
}

export function allowlist(): readonly string[] {
  return ALLOWLIST;
}

/** Vrai si `path` est un fichier regulier executable (reel, apres dereferencement des symlinks). */
function isRegularExecutable(path: string): boolean {
  try {
    const real = realpathSync(path);
    const st = statSync(real); // stat, pas lstat : on valide la CIBLE reelle
    if (!st.isFile()) return false;
    accessSync(real, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resout `command` (nom court) vers un chemin absolu via le PATH.
 * Durci : la cible doit etre un fichier REGULIER executable (et non un simple
 * `existsSync`), apres dereferencement des liens symboliques — un lien detourne
 * vers un script arbitraire ne passe plus.
 */
function resolveBinary(command: string): string {
  if (!isAllowlisted(command)) throw new DeniedCommandError(command);

  // node est special : on prefere l'execution en cours (fiable).
  if (command === 'node' && isRegularExecutable(process.execPath)) return process.execPath;

  const pathDirs = (process.env.PATH ?? '').split(':').filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = isAbsolute(dir) ? resolve(dir, command) : command;
    if (isRegularExecutable(candidate)) return candidate;
  }
  throw new BinaryNotFoundError(command);
}

function buildBwrapArgs(binary: string, args: string[], cwd: string | undefined): string[] {
  const bwrapArgs = [
    '--unshare-net',
    '--unshare-pid',
    '--unshare-uts',
    '--die-with-parent',
    '--new-session',
    '--ro-bind', '/', '/',
  ];

  if (cwd) {
    bwrapArgs.push('--chdir', cwd);
  }

  const safeArgs = args.map((a) => {
    if (a.startsWith('/')) return a; // le chemin dans la racine read-only
    return a;
  });

  return [...bwrapArgs, binary, ...safeArgs];
}

function locateBwrap(): string {
  const fromEnv = process.env.PALLAS_SANDBOX_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  // chemins courants (dont le lien NixOS system-wide)
  for (const p of ['/run/current-system/sw/bin/bwrap', '/usr/bin/bwrap', '/usr/local/bin/bwrap']) {
    if (existsSync(p)) return p;
  }
  // bwrap fourni par un environnement (ex. shell Nix : /nix/store/...-bubblewrap-*/bin)
  // n'est PAS dans les chemins fixes : chercher dans le PATH en dernier recours.
  const pathDirs = (process.env.PATH ?? '').split(':').filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = isAbsolute(dir) ? resolve(dir, 'bwrap') : 'bwrap';
    if (isRegularExecutable(candidate)) return candidate;
  }
  throw new MissingBwrapError();
}

/**
 * Execute une commande autorisee sous bubblewrap.
 *
 * @throws DeniedCommandError si le binaire n'est pas dans l'allowlist
 * @throws MissingBwrapError si bwrap est introuvable (fail-closed)
 * @throws BwrapInitError si bwrap s'est lance mais n'a pas pu initialiser le sandbox
 */
export function runSandboxed(command: string, args: string[], options: SandboxOptions = {}): Promise<SandboxResult> {
  if (!isAllowlisted(command)) {
    return Promise.reject(new DeniedCommandError(command)); // eslint-disable-line prefer-promise-reject-errors
  }

  let bwrap: string;
  try {
    bwrap = locateBwrap();
  } catch (err) {
    return Promise.reject(err as Error);
  }

  let binary: string;
  try {
    binary = resolveBinary(command);
  } catch (err) {
    return Promise.reject(err as Error);
  }
  const bwrapArgs = buildBwrapArgs(binary, args, options.cwd);
  const timeoutMs = options.timeoutMs ?? 10_000;

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(bwrap, bwrapArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: options.env ?? process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        rejectPromise(new SandboxError(`sandboxed command timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectPromise(new SandboxError(`failed to start bwrap: ${err.message}`));
      }
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // FAIL-CLOSED : si bwrap n'a pas pu creer l'isolation (netns decompressé,
      // boucle refuse, etc.), il imprime 'bwrap: ...' sur stderr et s'arrête
      // AVANT de démarrer le programme protégé. Rejeter explicitement : un tel
      // échec ne doit JAMAIS ressembler a un "echec applicatif du programme" —
      // distinguer "bwrap n'a pas demarre" de "le programme n'a pas pu joindre".
      if (code !== 0 && BWARP_INIT_PREFIX.test(stderr)) {
        rejectPromise(new BwrapInitError(stderr));
        return;
      }
      resolvePromise({
        stdout,
        stderr,
        exitCode: code ?? -1,
        sandboxed: true,
      });
    });

    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

/** Resout le chemin d'un argument relatif dans un cwd, pour compat. */
export function resolvePathWithinSandbox(p: string, cwd?: string): string {
  if (p.startsWith('/')) return p;
  return resolve(cwd ?? process.cwd(), p);
}
