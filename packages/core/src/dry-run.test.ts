import { test, beforeEach, expect } from 'vitest';
import {
  isDryRun,
  disableDryRun,
  enableDryRun,
  resetDryRunForTests,
  getDryRunState,
} from './dry-run.js';

beforeEach(() => {
  resetDryRunForTests();
});

test('dry-run actif par defaut', () => {
  expect(isDryRun()).toBe(true);
  expect(getDryRunState()).toBe('dry-run');
});

test('disableDryRun sans confirmation "LIVE" est refuse (fail-closed)', () => {
  const r = disableDryRun('oui');
  expect(r.warning !== null).toBe(true);
  expect(isDryRun()).toBe(true);
});

test('disableDryRun avec mauvaise confirmation est refuse', () => {
  disableDryRun('lIVE'); // casse incorrecte
  expect(isDryRun()).toBe(true);
  disableDryRun('LIVE '); // espace
  expect(isDryRun()).toBe(true);
});

test('disableDryRun avec confirmation exacte "LIVE" coupe le dry-run', () => {
  const r = disableDryRun('LIVE');
  expect(r.warning).toBe(null);
  expect(isDryRun()).toBe(false);
  expect(getDryRunState()).toBe('live');
});

test('enableDryRun retablit le mode sur', () => {
  disableDryRun('LIVE');
  enableDryRun();
  expect(isDryRun()).toBe(true);
});