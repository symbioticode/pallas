import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  structuredEvent,
  emitAnomaly,
  resetAnomalyAlertsForTest,
  type AlertSink,
} from './observability.js';

let alertFile: string;
const sink = (fetchFn?: typeof fetch): AlertSink => ({
  file: alertFile,
  ...(fetchFn ? { webhook: 'https://alerts.example.test/hook', fetchFn } : {}),
});

beforeEach(() => {
  resetAnomalyAlertsForTest();
  alertFile = join(mkdtempSync(join(tmpdir(), 'pallas-alerts-')), 'alerts.jsonl');
});

test('structuredEvent produit une ligne JSONL auto-décrite', () => {
  const event = structuredEvent('CRITICAL', 'ANOMALY.KILL_SWITCH', 'kill switch engaged', 'KILL_SWITCH', { market: 'abc' });
  expect(event.level).toBe('CRITICAL');
  expect(event.anomaly).toBe('KILL_SWITCH');
  expect(event.context).toEqual({ market: 'abc' });
  expect(typeof event.ts).toBe('string');
});

test('emitAnomaly écrit une ligne CRITICAL dans le fichier d alertes', async () => {
  const emitted = emitAnomaly('STATE_CORRUPT', 'checksum mismatch', { source: 'risk-state.json' }, sink());
  expect(emitted).toBe(true);
  const lines = readFileSync(alertFile, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(1);
  const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
  expect(parsed['level']).toBe('CRITICAL');
  expect(parsed['anomaly']).toBe('STATE_CORRUPT');
  expect(parsed['event']).toBe('ANOMALY.STATE_CORRUPT');
  expect((parsed['context'] as Record<string, unknown>)['source']).toBe('risk-state.json');
});

test('l anomalie restant active est dédupliquée (pas de spam de polling)', async () => {
  emitAnomaly('AMBIGUOUS_ORDER', 'unknown result', { correlation_id: 'c1' }, sink());
  const second = emitAnomaly('AMBIGUOUS_ORDER', 'unknown result bis', { correlation_id: 'c2' }, sink());
  expect(second).toBe(false);
  expect(readFileSync(alertFile, 'utf8').trim().split('\n')).toHaveLength(1);
});

test('resetAnomalyAlertsForTest réarme la ré-émission', async () => {
  emitAnomaly('KILL_SWITCH', 'cancel-all fired', undefined, sink());
  resetAnomalyAlertsForTest();
  const reemitted = emitAnomaly('KILL_SWITCH', 'engaged again', undefined, sink());
  expect(reemitted).toBe(true);
  expect(readFileSync(alertFile, 'utf8').trim().split('\n')).toHaveLength(2);
});

test('webhook posté en fire-and-forget quand fourni (PALLAS_ALERT_WEBHOOK)', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response('ok', { status: 200 });
  };
  emitAnomaly('RECONCILE_FAILED', 'scope unresolved', undefined, {
    file: alertFile,
    webhook: 'https://hook.example/i',
    fetchFn: fakeFetch as unknown as typeof fetch,
  });
  await new Promise((r) => setTimeout(r, 10));
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe('https://hook.example/i');
  const body = calls[0]!.init.body as string;
  expect(JSON.parse(body)['anomaly']).toBe('RECONCILE_FAILED');
});

test('une anomalie déjà active ne re-poste pas le webhook', async () => {
  let count = 0;
  const fakeFetch = async () => { count += 1; return new Response('ok'); };
  const s: AlertSink = { file: alertFile, webhook: 'https://hook.example/i', fetchFn: fakeFetch as unknown as typeof fetch };
  emitAnomaly('LEDGER_CORRUPT', 'chain broken', undefined, s);
  emitAnomaly('LEDGER_CORRUPT', 'again', undefined, s);
  await new Promise((r) => setTimeout(r, 10));
  expect(count).toBe(1);
});