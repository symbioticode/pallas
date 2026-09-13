/**
 * PALLAS-M20 / PALLAS-M26 — Observabilité minimale : alertes structurées JSON + webhook.
 *
 * Pas un système d'observabilité ambitieux (pas de Prometheus ici) : un
 * mécanisme simple mais réel — chaque anomalie critique émet une ligne JSON
 * dédiée (level: "CRITICAL") dans .pallas/alerts.jsonl, lisible par un
 * opérateur ou un outil externe, et optionnellement postée sur un webhook
 * (PALLAS_ALERT_WEBHOOK). Une anomalie est dédupliquée en mémoire tant
 * qu'elle reste "active" (aucun spam de polling), puis ré-émise à la
 * co-occurrence suivante.
 *
 * PALLAS-M26 — fiabilité de l'acheminement : le webhook n'est plus un essai
 * unique avalé. On tente un nombre BORNÉ de fois (backoff exponentiel simple),
 * et un échec FINAL persiste une ligne WARN "ALERT_DELIVERY_FAILED" dans le même
 * JSONL : la ligne CRITICAL reste, la ligne d'échec s'y ajoute, et un lecteur
 * externe peut donc détecter un BACKLOG d'alertes non acquittées.
 *
 * GARANTIE RÉELLE (à ne pas surinterpréter) : toute anomalie est écrite
 * LOCALEMENT (durable tant que le disque l'est) ; la livraison webhook est
 * BEST-EFFORT avec retry borné — aucune garantie de livraison distante forte,
 * aucun accusé de réception, aucune queue persistante.
 *
 * Les anomalies couvrent les incidents nommés par l'audit (F-10 §8) :
 *   - AMBIGUOUS_ORDER  : résultat d'ordre inconnu après contact réseau (M14)
 *   - RECONCILE_FAILED : échec de réconciliation (M14), scope non réglé
 *   - STATE_CORRUPT    : état durable falsifié/checksum cassé (M13)
 *   - LEDGER_CORRUPT   : chaîne du ledger invalide/tronquée (M16, fail-stop)
 *   - KILL_SWITCH      : kill switch ENGAGÉ (émission bloquée, cancel-all)
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type AnomalyKind =
  | 'AMBIGUOUS_ORDER'
  | 'RECONCILE_FAILED'
  | 'STATE_CORRUPT'
  | 'LEDGER_CORRUPT'
  | 'KILL_SWITCH';

export type AlertLevel = 'INFO' | 'WARN' | 'CRITICAL';

export interface AlertEvent {
  ts: string;
  level: AlertLevel;
  anomaly: AnomalyKind | null;
  event: string;
  subject: string;
  context?: Record<string, unknown>;
}

/** Un line JSON auto-décrit, ingérable par n'importe quel parser JSONL. */
export function structuredEvent(
  level: AlertLevel,
  event: string,
  subject: string,
  anomaly: AnomalyKind | null = null,
  context?: Record<string, unknown>,
): AlertEvent {
  return {
    ts: new Date().toISOString(),
    level,
    anomaly,
    event,
    subject,
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
  };
}

/** Sink configurable : destination fichier + webhook optionnel avec retry borné. */
export interface AlertSink {
  /** Chemin du fichier JSONL d'alertes (env PALLAS_ALERT_FILE, défaut .pallas/alerts.jsonl). */
  file?: string;
  /** URL du webhook (env PALLAS_ALERT_WEBHOOK). */
  webhook?: string;
  /** Fonction de fetch injectable (tests) — défaut : fetch global Node. */
  fetchFn?: typeof fetch;
  /** Tentatives SUPPLÉMENTAIRES après le premier échec (défaut 2). */
  webhookRetries?: number;
  /** Backoff de base entre tentatives en ms (défaut 200). */
  webhookBackoffMs?: number;
}

export interface ResolvedAlertSink {
  file: string;
  webhook?: string;
  fetchFn?: typeof fetch;
  webhookRetries: number;
  webhookBackoffMs: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function resolveAlertSink(overrides?: AlertSink): ResolvedAlertSink {
  const file = overrides?.file ?? process.env.PALLAS_ALERT_FILE ?? '.pallas/alerts.jsonl';
  const webhook = overrides?.webhook ?? process.env.PALLAS_ALERT_WEBHOOK ?? undefined;
  const fetchFn = overrides?.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
  const webhookRetries = overrides?.webhookRetries ?? envInt('PALLAS_ALERT_WEBHOOK_RETRIES', 2);
  const webhookBackoffMs = overrides?.webhookBackoffMs ?? envInt('PALLAS_ALERT_RETRY_BACKOFF_MS', 200);
  return {
    file,
    ...(webhook ? { webhook } : {}),
    ...(fetchFn ? { fetchFn } : {}),
    webhookRetries,
    webhookBackoffMs,
  };
}

/** Anomalies actuellement "actives" (dédupliquées en mémoire par process). */
const activeAnomalies = new Set<AnomalyKind>();

/** Purge l'état de déduplication — usage tests uniquement (reset inter-tests). */
export function resetAnomalyAlertsForTest(): void {
  activeAnomalies.clear();
}

/** Livraisons webhook en vol (les tests peuvent les attendre). */
const pendingDeliveries = new Set<Promise<void>>();

/** Attend la fin de toutes les livraisons webhook en vol (tests). */
export async function flushAlertDeliveriesForTest(): Promise<void> {
  while (pendingDeliveries.size > 0) {
    await Promise.allSettled([...pendingDeliveries]);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function appendAlertLine(file: string, line: string): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, line + '\n', 'utf8');
    return true;
  } catch {
    // écrire une alerte ne doit jamais faire échouer le process signalé
    return false;
  }
}

/**
 * Livraison webhook avec retry borné. Échec final => ligne WARN
 * ALERT_DELIVERY_FAILED persistée dans le MÊME fichier (backlog détectable).
 * Ne throw jamais (une alerte ne doit pas tuer le process qui signale).
 */
async function deliverWithRetry(
  sink: ResolvedAlertSink,
  line: string,
  anomaly: AnomalyKind,
  subject: string,
): Promise<void> {
  if (!sink.webhook || !sink.fetchFn) return;
  const attempts = sink.webhookRetries + 1;
  let lastError = 'unknown';
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await sink.fetchFn(sink.webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: line,
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (i < attempts - 1) await sleep(sink.webhookBackoffMs * 2 ** i);
  }
  const failed = structuredEvent('WARN', 'ALERT_DELIVERY_FAILED', subject, anomaly, {
    attempts,
    last_error: lastError.slice(0, 200),
    webhook: sink.webhook,
  });
  appendAlertLine(sink.file, JSON.stringify(failed));
}

/**
 * Émet une alerte CRITICAL pour une anomalie, si elle n'est pas déjà active.
 * Side effects : ligne JSONL fichier (TOUJOURS) + POST webhook best-effort avec
 * retry borné (jamais bloquant, jamais throw).
 */
export function emitAnomaly(
  anomaly: AnomalyKind,
  subject: string,
  context?: Record<string, unknown>,
  overrides?: AlertSink,
): boolean {
  if (activeAnomalies.has(anomaly)) return false;
  const sink = resolveAlertSink(overrides);
  const event = structuredEvent('CRITICAL', `ANOMALY.${anomaly}`, subject, anomaly, context);
  const line = JSON.stringify(event);
  if (!appendAlertLine(sink.file, line)) return false;
  activeAnomalies.add(anomaly);
  if (sink.webhook && sink.fetchFn) {
    const p: Promise<void> = deliverWithRetry(sink, line, anomaly, subject).finally(() => {
      pendingDeliveries.delete(p);
    });
    pendingDeliveries.add(p);
  }
  return true;
}