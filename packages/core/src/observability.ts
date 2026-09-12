/**
 * PALLAS-M20 — Observabilité minimale : alertes structurées JSON + webhook.
 *
 * Pas un système d'observabilité ambitieux (pas de Prometheus ici) : un
 * mécanisme simple mais réel — chaque anomalie critique émet une ligne JSON
 * dédiée (`level: "CRITICAL"`) dans `.pallas/alerts.jsonl`, lisible par un
 * opérateur ou un outil externe, et optionnellement postée sur un webhook
 * (`PALLAS_ALERT_WEBHOOK`). Une anomalie est dédupliquée en mémoire tant
 * qu'elle reste "active" (aucun spam de polling), puis ré-émise à la
 * co-occurrence suivante.
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

/** Sink configurable : destination fichier + webhook optionnel. */
export interface AlertSink {
  /** Chemin du fichier JSONL d'alertes (env `PALLAS_ALERT_FILE`, défaut `.pallas/alerts.jsonl`). */
  file?: string;
  /** URL du webhook pour POST fire-and-forget (env `PALLAS_ALERT_WEBHOOK`). */
  webhook?: string;
  /** Fonction de fetch injectable (tests) — défaut : fetch global Node. */
  fetchFn?: typeof fetch;
}

export function resolveAlertSink(
  overrides?: AlertSink,
): { file: string; webhook?: string; fetchFn?: typeof fetch } {
  const file = overrides?.file ?? process.env.PALLAS_ALERT_FILE ?? '.pallas/alerts.jsonl';
  const webhook = overrides?.webhook ?? process.env.PALLAS_ALERT_WEBHOOK ?? undefined;
  const fetchFn = overrides?.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
  return { file, ...(webhook ? { webhook } : {}), ...(fetchFn ? { fetchFn } : {}) };
}

/** Anomalies actuellement "actives" (dédupliquées en mémoire par process). */
const activeAnomalies = new Set<AnomalyKind>();

/** Purge l'état de déduplication — usage tests uniquement (reset inter-tests). */
export function resetAnomalyAlertsForTest(): void {
  activeAnomalies.clear();
}

/**
 * Émet une alerte CRITICAL pour une anomalie, si elle n'est pas déjà active.
 * Side effects : ligne JSONL fichier + (optionnel) POST webhook fire-and-forget.
 * Ne throw jamais — une alerte ne doit pas faire tomber le process qui signale.
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
  try {
    mkdirSync(dirname(sink.file), { recursive: true });
    appendFileSync(sink.file, line + '\n', 'utf8');
    activeAnomalies.add(anomaly);
  } catch {
    // écrire une alerte ne doit jamais faire échouer le process signalé
    return false;
  }
  if (sink.webhook && sink.fetchFn) {
    void sink
      .fetchFn(sink.webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: line,
        signal: AbortSignal.timeout(5_000),
      })
      .catch(() => undefined);
  }
  return true;
}