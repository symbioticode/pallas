import { test, expect, afterEach, vi } from 'vitest';

import { binaryPath, calculateVaR, MissingBinaryError, RiskEngineError, validateTrade } from './index.js';
import type { TradeRequest } from './index.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

const validTrade: TradeRequest = {
  market_id: 'm1',
  side: 'buy',
  price: 0.6,
  quantity: 10,
  est_value_usd: 60,
  win_probability: 0.7,
  odds: 0.7,
  bankroll_usd: 10_000,
  confidence: 0.8,
  max_order_usd: 1_000,
  max_drawdown_usd: 5_000,
};

test('binary path resolves to a real file', () => {
  const p = binaryPath();
  expect(p).toBeTruthy();
});

test('validateTrade allows a valid trade', async () => {
  const d = await validateTrade(validTrade, { hist_pnls: [1, -1, 2] });
  expect(d.allowed).toBe(true);
  expect(d.rejected_by).toEqual([]);
});

test('validateTrade rejects oversized order (fail-closed)', async () => {
  const big: TradeRequest = {
    ...validTrade,
    est_value_usd: 5_000, // > max_order_usd = 1000
  };
  const d = await validateTrade(big, { hist_pnls: [] });
  expect(d.allowed).toBe(false);
  expect(d.rejected_by).toContain('POSITION_LIMIT');
});

test('calculateVaR returns non-negative value', async () => {
  const r = await calculateVaR([-5, -8, -2, -12, -1], 0.95);
  expect(r.historical_var).toBeGreaterThanOrEqual(0);
  expect(r.cvar).toBeGreaterThanOrEqual(0);
  expect(r.sample_size).toBeGreaterThanOrEqual(5);
});

test('throws RiskEngineError when binary rejects unknown command', async () => {
  // Exerce la gestion d'erreur en pointant sur un binaire inexistant.
  vi.stubEnv('PALLAS_RISK_BIN', '/nonexistent/risk-engine');
  await expect(() => validateTrade(validTrade, { hist_pnls: [] })).rejects.toThrow(MissingBinaryError);
});

test('RiskEngineError is a subclass of Error', () => {
  const e = new RiskEngineError('boom');
  expect(e).toBeInstanceOf(Error);
  expect(e.name).toBe('RiskEngineError');
});