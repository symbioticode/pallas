/**
 * Signature de la TÊTE du ledger (PALLAS-M16) — clé OB-séparée du process.
 *
 * Le chaînage SHA-256 (M12) est une détection d'erreur accidentelle : un
 * attaquant ayant accès au fichier peut modifier/supprimer/réordonner PUIS
 * recalculer tous les hashes avec la fonction exportée. La parade n'est pas un
 * second secret stocké au même endroit, c'est une signature asymétrique Ed25519
 * dont la clé PRIVÉE vit HORS du process qui écrit le ledger :
 *
 *   - le process stratégie (écrivain courant) ne détient que la CLÉ PUBLIQUE :
 *     elle est autorisée en mémoire, elle ne PEUT PAS produire de chaîne
 *     falsifiée qui passe la vérification ;
 *   - la clé privée est utilisée UNIQUEMENT par un outil opérateur séparé
 *     (`sign-ledger.ts`, conteneur/offline de préférence) pour signer
 *     PÉRIODIQUEMENT un résumé/checkpoint de la chaîne : index de tête, hash de
 *     tête, racine, timestamp.
 *
 * Le checkpoint est un fichier `<ledger>.sig` à côté du ledger. La vérification
 * au chargement veut : chaîne SHA-256 vérifiée (M12) ET — si un checkpoint est
 * présent — `head_index`/`head_hash` identiques à la tête courante ET signature
 * vérifiée par la clé publique configurée. Réécrire la chaîne en recalculant les
 * hashes change le `head_hash` : la signature (portée sur l'ancien head) ne
 * correspond plus → falsification détectée.
 *
 * ATTENTION — promesse exacte : cette signature rend une falsification du
 * FICHIER seul détectable. Elle ne protège PAS contre la compromission du
 * process qui peut aussi commettre la clé privée ; elle ne remplace pas
 * l'ancrage distant/WORM (documenté comme limite dans docs/SECURITY.md).
 */

import { generateKeyPairSync, sign, verify } from 'node:crypto';

/** Paire de clés Ed25519 au format PEM (privée PKCS8, publique SPKI). */
export interface LedgerSigningKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

/** Génère une paire de clés Ed25519 pour signer/ancrer le ledger. */
export function generateLedgerSigningKeyPair(): LedgerSigningKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  };
}

/** Résumé signé de la tête de chaîne — contenu EXACT de `<ledger>.sig`. */
export interface LedgerCheckpoint {
  version: 1;
  /** Racine du ledger (`'pallas'`) — empêche d'échanger un fichier d'un autre arbre. */
  root: string;
  /** Index de la tête de chaîne au moment de la signature. */
  head_index: number;
  /** hash de la tête (hex SHA-256). */
  head_hash: string;
  /** event de la tête (pour lecture humaine/audit). */
  head_event: string;
  /** timestamp de la tête (ISO 8601). */
  head_timestamp: string;
  /** ISO 8601 du moment où l'opérateur a signé. */
  timestamp: string;
  /** Signature base64 Ed25519 sur la forme canonique TOUS champs hors `signature`. */
  signature: string;
}

/** Payload canonique signé : tous les champs sauf `signature`, clés triées. */
export function checkpointPayload(checkpoint: Omit<LedgerCheckpoint, 'signature'>): string {
  const { version, root, head_index, head_hash, head_event, head_timestamp, timestamp } = checkpoint;
  const parts = [
    `"head_event":${JSON.stringify(head_event)}`,
    `"head_hash":${JSON.stringify(head_hash)}`,
    `"head_index":${JSON.stringify(head_index)}`,
    `"head_timestamp":${JSON.stringify(head_timestamp)}`,
    `"root":${JSON.stringify(root)}`,
    `"timestamp":${JSON.stringify(timestamp)}`,
    `"version":${JSON.stringify(version)}`,
  ];
  return `{${parts.join(',')}}`;
}

/**
 * Signe la tête de la chaîne courante. À exécuter par l'OPÉRATEUR (outil
 * séparé), jamais par le process qui écrit le ledger.
 */
export function signLedgerCheckpoint(
  privateKeyPem: string,
  entries: readonly { index: number; event: string; timestamp: string; hash: string }[],
): LedgerCheckpoint {
  const head = entries[entries.length - 1];
  if (!head) {
    throw new Error('refus de signer un ledger vide (aucune tête à ancrer)');
  }
  const checkpoint: Omit<LedgerCheckpoint, 'signature'> = {
    version: 1,
    root: 'pallas',
    head_index: head.index,
    head_hash: head.hash,
    head_event: head.event,
    head_timestamp: head.timestamp,
    timestamp: new Date().toISOString(),
  };
  const payload = checkpointPayload(checkpoint);
  const signature = sign(null, Buffer.from(payload, 'utf8'), privateKeyPem);
  return { ...checkpoint, signature: signature.toString('base64') };
}

/**
 * Vérifie le checkpoint avec la CLÉ PUBLIQUE. Ne vérifie PAS encore la
 * correspondance avec la tête du fichier (fait par FileLedger.load).
 */
export function verifyLedgerCheckpoint(
  publicKeyPem: string,
  checkpoint: LedgerCheckpoint,
): boolean {
  const { signature, ...rest } = checkpoint;
  const payload = checkpointPayload(rest);
  try {
    return verify(
      null,
      Buffer.from(payload, 'utf8'),
      publicKeyPem,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

/** Valide la forme d'un objet checkpoint brut (atténue les faux positifs JSON). */
export function isLedgerCheckpoint(value: unknown): value is LedgerCheckpoint {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.root === 'string' &&
    typeof v.head_index === 'number' &&
    typeof v.head_hash === 'string' &&
    typeof v.head_event === 'string' &&
    typeof v.head_timestamp === 'string' &&
    typeof v.timestamp === 'string' &&
    typeof v.signature === 'string'
  );
}