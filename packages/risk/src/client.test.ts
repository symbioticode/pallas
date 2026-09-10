import { test, expect, afterEach, vi } from 'vitest';

import { binaryPath, calculateVaR, MissingBinaryError, recordPnl, RiskEngineError, validateTrade, validateTradeWithState } from './index.js';
import type { StateInput, TradeRequest } from './index.js';

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

test('validateTrade rejects the 2026-09-09 audit adversarial probe', async () => {
  const probe: TradeRequest = {
    market_id: '',
    side: 'garbage',
    price: 0.6,
    quantity: 10,
    est_value_usd: -100,
    win_probability: 2,
    odds: 0.7,
    bankroll_usd: 10_000,
    confidence: 0.8,
    max_order_usd: 1_000,
    max_drawdown_usd: 5_000,
  };
  const d = await validateTrade(probe, { hist_pnls: [] });
  expect(d.allowed).toBe(false);
  expect(d.suggested_size_usd).toBe(0);
  expect(d.rejected_by).toContain('INPUT_VALIDATION');
  expect(d.gates).toHaveLength(1);
});

test('validateTrade respects the kill switch (short-circuit)', async () => {
  const d = await validateTrade(validTrade, { hist_pnls: [], kill_switch_engaged: true });
  expect(d.allowed).toBe(false);
  expect(d.rejected_by).toContain('KILL_SWITCH');
  expect(d.gates).toHaveLength(1);
});

test('recordPnl accumulates consecutive losses across calls and trips the breaker', async () => {
  let state: StateInput = { hist_pnls: [] };
  for (let i = 0; i < 5; i++) {
    state = await recordPnl(state, -10);
  }
  expect(state.circuit_breaker!.consecutive_losses).toBe(5);
  expect(state.circuit_breaker!.state).toBe('Open');
  const d = await validateTrade(validTrade, state);
  expect(d.allowed).toBe(false);
  expect(d.rejected_by).toContain('CIRCUIT_BREAKER');
});

test('validateTrade returns the persistent state to store back', async () => {
  const { state } = await validateTradeWithState(validTrade, { hist_pnls: [1, -1] });
  expect(state.hist_pnls).toEqual([1, -1]);
  expect(state.kill_switch_engaged).toBe(false);
  expect(state.circuit_breaker).toBeDefined();
  expect(state.volatility.window).toBeInstanceOf(Array);
});