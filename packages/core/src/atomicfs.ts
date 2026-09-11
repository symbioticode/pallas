/**
 * Écriture atomique et durable de fichiers (PALLAS-M13).
 *
 * Un `writeFileSync` direct + `rename` peut laisser un fichier partiellement
 * réécrit après un crash, et `.tmp` fixe rend appels concurrents sujets à
 * écrasement. Ici :
 *
 *   1. nom temporaire UNIQUE (`.neutre.<pid>.<random>.tmp` — jamais `.tmp` fixe) ;
 *   2. écriture + `fsync` explicite du fichier (données sur disque, pas en cache) ;
 *   3. `rename` atomique (même FS = pas de fenêtre ou l'ancien disparaît) ;
 *   4. `fsync` du répertoire (le rename est lui-même rendu durable).
 *
 * Nettoyage best-effort du temporaire en cas d'échec intermédiaire.
 */

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** `fsync` sur un répertoire : le rename atomique devient durable. Best-effort
 * (certains systèmes de fichiers n'y répondent pas). */
export function fsyncDirectory(dir: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch {
    // tmpfs/overlayfs peuvent refuser ; l'intégrité reste garantie par le
    // fsync fichier + la chaîne de hash — on ne fait pas échouer l'écriture.
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* no-op */
      }
    }
  }
}

/** Écrit `data` dans `filePath` de façon atomique et durable. */
export function atomicWriteFileSafe(filePath: string, data: string): void {
  const resolved = resolve(filePath);
  const dir = dirname(resolved);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(resolved)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);

  let fd: number | null = null;
  try {
    fd = openSync(tmp, 'w', 0o600);
    const written = writeSync(fd, data, null, 'utf8');
    if (written !== Buffer.byteLength(data, 'utf8')) {
      throw new Error(`partial write on ${tmp} (${written}/${Buffer.byteLength(data)})`);
    }
    fsyncSync(fd);
  } catch (err) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* no-op */
      }
    }
    try {
      unlinkSync(tmp);
    } catch {
      /* no-op */
    }
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* no-op */
      }
    }
  }

  renameSync(tmp, resolved);
  fsyncDirectory(dir);
}