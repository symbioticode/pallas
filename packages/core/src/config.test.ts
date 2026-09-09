import { test, beforeEach, expect } from 'vitest';
import { loadConfig, applySafetyGates } from './config.js';
import { isDryRun, resetDryRunForTests } from './dry-run.js';

beforeEach(() => {
  resetDryRunForTests();
});

test('DRY_RUN non defini => dry-run true par defaut', () => {
  const cfg = loadConfig({});
  expect(cfg.trading.dryRun).toBe(true);
});

test('DRY_RUN=false => dryRun false', () => {
  const cfg = loadConfig({ DRY_RUN: 'false' });
  expect(cfg.trading.dryRun).toBe(false);
});

test('applySafetyGates en dry-run true => reste dry-run, pas de warning', () => {
  const cfg = loadConfig({}); // dryRun true
  const live = applySafetyGates(cfg);
  expect(live).toBe(false);
  expect(isDryRun()).toBe(true);
});

test('applySafetyGates en dryRun=false mais sans confirmation => reste dry-run (fail-closed)', () => {
  const cfg = loadConfig({ DRY_RUN: 'false' });
  const live = applySafetyGates(cfg);
  expect(live).toBe(false);
  expect(isDryRun()).toBe(true);
});

test('cle credentials vide => warning de config (schema), mais chargement ok', () => {
  const cfg = loadConfig({});
  expect(cfg.credentials.key).toBe('');
});

test('defaults gateway appliques', () => {
  const cfg = loadConfig({});
  expect(cfg.gateway.port).toBe(18789);
  expect(cfg.gateway.bind).toBe('127.0.0.1');
  expect(cfg.gateway.rateLimitPerMinute).toBe(100);
});

test('valeurs gateway depuis env', () => {
  const cfg = loadConfig({ PALLAS_PORT: '19999', PALLAS_BIND: '0.0.0.0' });
  expect(cfg.gateway.port).toBe(19999);
  expect(cfg.gateway.bind).toBe('0.0.0.0');
});