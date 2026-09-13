/**
 * PALLAS-M26 — le scénario manqué par l'audit v0.4 : une corruption d'état réelle
 * doit émettre STATE_CORRUPT au MOMENT DE LA DÉTECTION (la lecture), pas
 * seulement être consignée ailleurs. On reproduit une falsification de checksum.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resetAnomalyAlertsForTest } from '@pallas/core';

import { DurableStateStore } from './durable-state.js';

const VALID_STATE =
  JSON.parse('{"hist_pnls":[],"kill_switch_engaged":false,' +
  '"circuit_breaker":{"state":"Closed","consecutive_losses":0,"cumulative_pnl":0,"peak_pnl":0,"since_trip":0},' +
  '"volatility":{"window":[],"baseline":null},"exposure":[]}');

describe('PALLAS-M26 — STATE_CORRUPT émis au point de détection', () => {
  let dir: string;
  let alertFile: string;
  let saved: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pallas-m26-'));
    alertFile = join(dir, 'alerts.jsonl');
    saved = process.env.PALLAS_ALERT_FILE;
    process.env.PALLAS_ALERT_FILE = alertFile;
    resetAnomalyAlertsForTest();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.PALLAS_ALERT_FILE;
    else process.env.PALLAS_ALERT_FILE = saved;
    resetAnomalyAlertsForTest();
  });

  test('checksum falsifié => StateCorruptionError ET alerte STATE_CORRUPT persistée (avant M26 : aucune alerte)', () => {
    const statePath = join(dir, 'risk-state.json');
    const forged = { version: 2, checksum: '0'.repeat(64), risk: VALID_STATE, orders: [] };
    writeFileSync(statePath, JSON.stringify(forged), 'utf8');

    const store = new DurableStateStore(statePath);
    expect(() => store.read()).toThrow(/checksum|incohérent|corrompu/i);

    const lines = readFileSync(alertFile, 'utf8').trim().split('\n');
    const parsed = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
    expect(parsed['level']).toBe('CRITICAL');
    expect(parsed['anomaly']).toBe('STATE_CORRUPT');
    expect(parsed['event']).toBe('ANOMALY.STATE_CORRUPT');
  });

  test('JSON tronqué => alerte STATE_CORRUPT également émise à la lecture', () => {
    const statePath = join(dir, 'risk-state.json');
    writeFileSync(statePath, '{ broken', 'utf8');
    const store = new DurableStateStore(statePath);
    expect(() => store.read()).toThrow();
    const events = readFileSync(alertFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.some((e) => e['anomaly'] === 'STATE_CORRUPT')).toBe(true);
  });
});