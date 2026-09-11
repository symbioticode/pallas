/**
 * Persistance TRANSACTIONNELLE et durable de l'état du pipeline (PALLAS-M13).
 *
 * Remplace la persistance naïve de M12 (`loadState`/`saveState`, qui avalait
 * la corruption et réécrivait sans lock/fsync) par un document versionné,
 * checksummé, verrouillé et fail-stop :
 *
 *   { "version": 2, "checksum": sha256(...), "risk": StateOutput,
 *     "orders": [OrderLifecycle], "meta": {...} }
 *
 * Propriétés exigées par l'audit v0.3 §4.5 :
 *  - `read()` distingue "fichier ABSENT au tout premier démarrage" (état neuf
 *    légitime) de "fichier PRÉSENT mais invalide/tronqué/checksum faux"
 *    (erreur FATALE — le système refuse de démarrer, jamais d'état neuf
 *    silencieux au-delà du premier démarrage).
 *  - écriture atomique + durable : temp à nom unique + fsync fichier + fsync
 *    répertoire + rename (via `@pallas/core` `atomicfs`), sous VERROU
 *    interprocessus (`file-lock`). Aucune écriture sans verrou.
 *  - chaque décision/ordre porte un `correlationId` associé à une machine à
 *    états explicite : DECIDED → SUBMITTING → SUBMITTED / AMBIGUOUS → ACKED →
 *    TERMINAL. L'état est écrit DURABLEMENT avant tout appel réseau.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { atomicWriteFileSafe, FileLock, type FileLockOptions } from '@pallas/core';
import { StateOutputSchema, type StateOutput } from '@pallas/risk';
import { z } from 'zod';

/** Version du format d'état (bump = migration explicite). */
export const DURABLE_STATE_VERSION = 2;

export const OrderLifecycleStatusSchema = z.enum([
  'DECIDED',
  'SUBMITTING',
  'RECONCILING',
  'SUBMITTED',
  'AMBIGUOUS',
  'ACKED',
  'TERMINAL',
]);
export type OrderLifecycleStatus = z.infer<typeof OrderLifecycleStatusSchema>;

export const OrderLifecycleSchema = z
  .object({
    /** Identifiant de corrélation unique de bout en bout (decision→ordre→ledger). */
    correlationId: z.string().uuid(),
    market_id: z.string().min(1),
    side: z.enum(['buy', 'sell']),
    price: z.number().finite().positive(),
    quantity: z.number().finite().positive(),
    est_value_usd: z.number().finite().positive(),
    /** Hash canonique de l'intention (champs déterminants de l'ordre). */
    intent_hash: z.string().regex(/^[0-9a-f]{64}$/),
    status: OrderLifecycleStatusSchema,
    terminal_reason: z.enum(['filled', 'cancelled', 'rejected']).nullish(),
    order_id: z.string().nullish(),
    attempt: z.number().int().positive(),
    /** Note d'exécution (ex. "dry_run_blocked", "pending_reconciliation"). */
    outcome: z.string().nullish(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export type OrderLifecycle = z.infer<typeof OrderLifecycleSchema>;

export const DurableStateDocSchema = z.object({
  version: z.literal(DURABLE_STATE_VERSION),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  risk: StateOutputSchema,
  orders: z.array(OrderLifecycleSchema),
  /** Méta-données opérateur (compteurs, annotations) — couvert par le checksum. */
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type DurableStateDoc = z.infer<typeof DurableStateDocSchema>;

/** Erreur FATALE : état présent mais illisible/corrompu. Refuse de démarrer. */
export class StateCorruptionError extends Error {
  constructor(reason: string) {
    super(
      `FATAL: état du pipeline invalide ou corrompu (${reason}) — démarrage refusé, ` +
        `jamais de réinitialisation silencieuse. Corriger/supprimer le fichier ou annuler le trade.`,
    );
    this.name = 'StateCorruptionError';
  }
}

/** Erreur de verrou : un autre process tient le fichier d'état. */
export class StateLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateLockError';
  }
}

/** Sérialisation canonique (clés triées, zéro espace) — même règle que le ledger. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${parts.join(',')}}`;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Checksum de l'état : couvre risk + orders + meta (pas `checksum` lui-même). */
export function checksumOfState(risk: StateOutput, orders: OrderLifecycle[], meta?: Record<string, unknown>): string {
  return sha256Hex(canonicalJson({ version: DURABLE_STATE_VERSION, risk, orders, meta }));
}

/** État neuf — UNIQUEMENT pour le tout premier démarrage (fichier absent). */
export function freshState(meta?: Record<string, unknown>): DurableStateDoc {
  const risk: StateOutput = {
    hist_pnls: [],
    kill_switch_engaged: false,
    circuit_breaker: {
      state: 'Closed',
      consecutive_losses: 0,
      cumulative_pnl: 0,
      peak_pnl: 0,
      since_trip: 0,
    },
    volatility: { window: [], baseline: null },
  };
  return {
    version: DURABLE_STATE_VERSION,
    checksum: checksumOfState(risk, [], meta),
    risk,
    orders: [],
    ...(meta !== undefined ? { meta } : {}),
  };
}

/** Input de la machine d'états : l'intention (champs déterminants de l'ordre). */
export interface OrderIntent {
  market_id: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  est_value_usd: number;
}

/** Hash canonique de l'intention déclarée. */
export function intentHashOf(intent: OrderIntent): string {
  return sha256Hex(
    canonicalJson({
      market_id: intent.market_id,
      side: intent.side,
      price: intent.price,
      quantity: intent.quantity,
      est_value_usd: intent.est_value_usd,
    }),
  );
}

let seq = 0;
/** Milieux uniques locaux pour les probes/test-only (jamais en prod). */
export function nextProbeId(): string {
  seq += 1;
  return `probe-${process.pid}-${seq}`;
}

/** Crée un cycle de vie d'ordre à l'état DECIDED (avant tout appel réseau). */
export function newLifecycle(
  intent: OrderIntent,
  opts: { correlationId?: string; attempt?: number } = {},
): OrderLifecycle {
  const now = new Date().toISOString();
  const correlationId = opts.correlationId ?? randomUUID();
  return {
    correlationId,
    market_id: intent.market_id,
    side: intent.side,
    price: intent.price,
    quantity: intent.quantity,
    est_value_usd: intent.est_value_usd,
    intent_hash: intentHashOf(intent),
    status: 'DECIDED',
    attempt: opts.attempt ?? 1,
    order_id: null,
    created_at: now,
    updated_at: now,
  };
}

/** Applique une transition d'état (retourne une copie ; ne mute pas `doc` ici). */
export function transitionLifecycle(
  lifecycle: OrderLifecycle,
  patch: {
    status: OrderLifecycleStatus;
    terminal_reason?: string;
    order_id?: string | null;
    outcome?: string;
  },
): OrderLifecycle {
  return {
    ...lifecycle,
    status: patch.status,
    ...(patch.terminal_reason !== undefined ? { terminal_reason: patch.terminal_reason as OrderLifecycle['terminal_reason'] } : {}),
    ...(patch.order_id !== undefined ? { order_id: patch.order_id } : {}),
    ...(patch.outcome !== undefined ? { outcome: patch.outcome } : {}),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Store transactionnel de l'état : lecture fail-stop, écriture atomique sous
 * verrou. Toute mutation se fait via `withLock` (lecture fraîche → mutation →
 * écriture → release).
 */
export class DurableStateStore {
  private readonly statePath: string;

  constructor(statePath: string) {
    this.statePath = resolve(statePath);
  }

  get path(): string {
    return this.statePath;
  }

  /** Lecture FAIL-STOP. Fichier absent = premier démarrage légitime (état neuf).
   * Présent mais invalide (JSON, schéma, version, checksum) = erreur fatale. */
  read(): DurableStateDoc {
    let rawStr: string;
    try {
      rawStr = readFileSync(this.statePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return freshState();
      }
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(rawStr);
    } catch {
      throw new StateCorruptionError('fichier présent mais JSON invalide/tronqué');
    }
    const parsed = DurableStateDocSchema.safeParse(raw);
    if (!parsed.success) {
      throw new StateCorruptionError(schemaFailureSummary(parsed.error));
    }
    const doc = parsed.data;
    const recomputed = checksumOfState(doc.risk, doc.orders, doc.meta);
    if (doc.checksum !== recomputed) {
      throw new StateCorruptionError('checksum incohérent avec le contenu (falsification ou corruption)');
    }
    return doc;
  }

  /** Écriture atomique + checksum recalculé. **Doit** être appelée sous verrou.
   * Valide le document AVANT écriture : un bug de transition ne peut pas
   * persister un état structurellement invalide. */
  write(doc: DurableStateDoc): void {
    const validated = DurableStateDocSchema.parse(doc);
    const next: DurableStateDoc = {
      version: DURABLE_STATE_VERSION,
      checksum: checksumOfState(validated.risk, validated.orders, validated.meta),
      risk: validated.risk,
      orders: validated.orders,
      ...(validated.meta !== undefined ? { meta: validated.meta } : {}),
    };
    atomicWriteFileSafe(this.statePath, JSON.stringify(next, null, 2) + '\n');
  }

  /**
   * Prochain `correlationId` : l'état persistant garde trace des derniers IDs
   * émis (liste `meta.last_correlation_ids`), pour détecter les collisions
   * entre processus et garantir l'unicité de bout en bout.
   */
  nextCorrelationId(doc: DurableStateDoc): string {
    const ids: string[] = Array.isArray(doc.meta?.last_correlation_ids)
      ? (doc.meta!.last_correlation_ids as string[])
      : [];
    for (let i = 0; i < 8; i += 1) {
      const candidate = randomUUID();
      if (!ids.includes(candidate) && !doc.orders.some((o) => o.correlationId === candidate)) {
        return candidate;
      }
    }
    throw new StateCorruptionError('impossible de générer un correlationId unique');
  }

  /** Acquiert le verrou, exécute `fn(lectureFraîche)`, relâche TOUJOURS. */
  async withLock<T>(fn: (doc: DurableStateDoc) => T | Promise<T>, lockOptions?: FileLockOptions): Promise<T> {
    const lock = new FileLock(this.statePath, lockOptions);
    try {
      await lock.acquire();
    } catch (err) {
      if (err instanceof Error && err.name === 'FileLockError') {
        throw new StateLockError(err.message);
      }
      throw err;
    }
    try {
      return await fn(this.read());
    } finally {
      lock.release();
    }
  }
}

function schemaFailureSummary(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .slice(0, 5)
    .join('; ');
}