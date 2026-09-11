import { test, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  est_value_usd: 6, // coherent : price × quantity = 6 (PALLAS-M09)
  win_probability: 0.7,
  odds: 0.7,
  confidence: 0.8,
  market_data_age_ms: 0,
};

/** Configuration de risque OPERATEUR de test (PALLAS-M15) : les limites ne
 *  vivent plus dans le trade, mais dans cette configuration. */
const TEST_RISK_CONFIG = {
  bankroll_usd: 10_000,
  max_order_usd: 1_000,
  max_portfolio_exposure_usd: 1_000,
  max_drawdown_usd: 5_000,
  max_concentration_usd: 1_000,
  half_open_probe_size_usd: 50,
  var_min_observations: 2,
  var_startup_envelope_usd: 1_000,
  max_market_data_age_ms: 600_000,
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
    est_value_usd: 5_000, // > max_order_usd = 1000 de la CONFIG (PALLAS-M15)
  };
  const d = await validateTrade(big, { hist_pnls: [] }, TEST_RISK_CONFIG);
  expect(d.allowed).toBe(false);
  expect(d.rejected_by).toContain('POSITION_LIMIT');
});

test('M15: les limites viennent de la CONFIG, pas du trade', async () => {
  // Même intention (value 20) : verdict opposé selon riskConfig fournie.
  const intent: TradeRequest = { ...validTrade, est_value_usd: 20, quantity: 20 / 0.6 };
  const tight = await validateTrade(intent, { hist_pnls: [1, -1] }, { ...TEST_RISK_CONFIG, max_order_usd: 10, max_portfolio_exposure_usd: 10, max_concentration_usd: 10, var_startup_envelope_usd: 10 });
  expect(tight.allowed).toBe(false);
  expect(tight.rejected_by).toContain('POSITION_LIMIT');
  const loose = await validateTrade(intent, { hist_pnls: [1, -1] }, TEST_RISK_CONFIG);
  expect(loose.allowed).toBe(true);
});

test('M15: donnees stale rejetees (garde market_data_freshness)', async () => {
  const stale: TradeRequest = { ...validTrade, market_data_age_ms: 900_000 }; // > 600_000
  const d = await validateTrade(stale, { hist_pnls: [1, -1] }, TEST_RISK_CONFIG);
  expect(d.allowed).toBe(false);
  expect(d.rejected_by).toContain('MARKET_DATA_FRESHNESS');
});

test('M15: exposition reelle (orders) portee par l etat borne les ordres suivants', async () => {
  // L'exposition est calculée par le cycle depuis les ordres du document et
  // injectée dans l'état (réconciliation M14) : 998 + 6 = 1004 > 1000.
  const d = await validateTrade(
    validTrade,
    { hist_pnls: [1, -1], exposure: [{ market_id: 'm1', size_usd: 998 }] },
    TEST_RISK_CONFIG,
  );
  expect(d.allowed).toBe(false);
  expect(d.rejected_by).toContain('POSITION_LIMIT');
});

test('M15: concentration par marche bornee depuis la config', async () => {
  // max_concentration_usd = 300 : exposition 304 sur le même marché + l'ordre
  // (6) = 310 > 300 → CONCENTRATION_LIMIT, alors que le portefeuille global
  // (310) reste sous la limite 1000.
  const d = await validateTrade(
    validTrade,
    { hist_pnls: [1, -1], exposure: [{ market_id: 'm1', size_usd: 304 }] },
    { ...TEST_RISK_CONFIG, max_concentration_usd: 300, max_portfolio_exposure_usd: 1000 },
  );
  expect(d.allowed).toBe(false);
  expect(d.rejected_by).toContain('CONCENTRATION_LIMIT');
});

test('calculateVaR returns non-negative value', async () => {
  const r = await calculateVaR([-5, -8, -2, -12, -1], 0.95);
  expect(r.historical_var).toBeGreaterThanOrEqual(0);
  expect(r.cvar).toBeGreaterThanOrEqual(0);
  expect(r.sample_size).toBeGreaterThanOrEqual(5);
  expect(r.status).toBe('ESTIMATED');
});

test('M15: VaR distingue manque de donnees de risque nul (F-08)', async () => {
  // < 2 observations => INSUFFICIENT_DATA, jamais "risque 0" silencieux.
  const empty = await calculateVaR([], 0.95);
  expect(empty.status).toBe('INSUFFICIENT_DATA');
  const single = await calculateVaR([-10], 0.95);
  expect(single.status).toBe('INSUFFICIENT_DATA');
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
    confidence: 0.8,
    market_data_age_ms: 0,
  };
  const d = await validateTrade(probe, { hist_pnls: [] }, TEST_RISK_CONFIG);
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

// --- PALLAS-M04 : frontiere risk engine — validation runtime stricte ---

/** Installe une fausse binaire Rust dont stdout/exit sont controles. */
function fakeRiskBinary(stdout: string, code = 0): string {
  const dir = mkdtempSync(join(tmpdir(), 'pallas-risk-fake-'));
  const bin = join(dir, 'risk-engine');
  const quoted = stdout.replace(/'/g, "'\\''");
  writeFileSync(bin, `#!/bin/sh\ncat > /dev/null\nprintf '%s' '${quoted}'\nexit ${code}\n`, { mode: 0o755 });
  return bin;
}

const VALID_STATE_JSON =
  '{"hist_pnls":[1,-1],"kill_switch_engaged":false,' +
  '"circuit_breaker":{"state":"Closed","consecutive_losses":0,"cumulative_pnl":0,"peak_pnl":0,"since_trip":0},' +
  '"volatility":{"window":[],"baseline":null},"exposure":[]}';

test('M04: invoke rejette une reponse validate dont le type d.un champ est faux', async () => {
  // suggested_size_usd est une string au lieu d'un nombre : cast aveugle aurait laissé passer.
  vi.stubEnv(
    'PALLAS_RISK_BIN',
    fakeRiskBinary(
      `{"decision":{"allowed":true,"gates":[],"rejected_by":[],"suggested_size_usd":"big"},"state":${VALID_STATE_JSON}}`,
    ),
  );
  await expect(() => validateTrade(validTrade, { hist_pnls: [] })).rejects.toThrow(RiskEngineError);
});

test('M04: invoke rejette une reponse validate dont un champ est manquant', async () => {
  // volatility absent de state : strict => contract violation, jamais objet partiel.
  const stateWithoutVolatility =
    '{"hist_pnls":[],"kill_switch_engaged":false,' +
    '"circuit_breaker":{"state":"Open","consecutive_losses":3,"cumulative_pnl":-40,"peak_pnl":0,"since_trip":1}}';
  vi.stubEnv(
    'PALLAS_RISK_BIN',
    fakeRiskBinary(`{"decision":${'{"allowed":false,"gates":[],"rejected_by":["X"],"suggested_size_usd":0}'},"state":${stateWithoutVolatility}}`),
  );
  await expect(() => validateTrade(validTrade, { hist_pnls: [] })).rejects.toThrow(/contract/);
});

test('M04: la reponse d.erreur CSSL reste detectee (error string)', async () => {
  vi.stubEnv('PALLAS_RISK_BIN', fakeRiskBinary('{"error":"garbage side value"}'));
  await expect(() => validateTrade(validTrade, { hist_pnls: [] })).rejects.toThrow(/garbage side value/);
});

test('M04: calculateVaR rejette un champ manquant (sample_size absent)', async () => {
  const varWithoutSample =
    '{"historical_var":1,"parametric_var":2,"cvar":3,"confidence_level":0.95,"mean_pnl":0,"std_dev":1}';
  vi.stubEnv('PALLAS_RISK_BIN', fakeRiskBinary(`{"var":${varWithoutSample}}`));
  await expect(() => calculateVaR([-1, -2], 0.95)).rejects.toThrow(RiskEngineError);
});

// --- PALLAS-M10 : PALLAS_RISK_BIN durci (meme rigueur que sandbox.ts isRegularExecutable) ---

test('M10: PALLAS_RISK_BIN vers un dossier => MissingBinaryError (rejete comme sandbox)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pallas-risk-bin-dir-'));
  vi.stubEnv('PALLAS_RISK_BIN', dir);
  await expect(() => validateTrade(validTrade, { hist_pnls: [] })).rejects.toThrow(MissingBinaryError);
});

test('M10: PALLAS_RISK_BIN un symlink vers un fichier non executable => MissingBinaryError', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pallas-risk-bin-link-'));
  const target = join(dir, 'target');
  writeFileSync(target, 'pas un executable'); // fichier regulier SANS droit x
  const link = join(dir, 'risk-engine');
  symlinkSync(target, link);
  vi.stubEnv('PALLAS_RISK_BIN', link);
  await expect(() => validateTrade(validTrade, { hist_pnls: [] })).rejects.toThrow(MissingBinaryError);
});

test('M10: validateTrade fonctionne toujour via PALLAS_RISK_BIN executable regulier', async () => {
  vi.stubEnv('PALLAS_RISK_BIN', fakeRiskBinary(`{"decision":{"allowed":true,"gates":[],"rejected_by":[],"suggested_size_usd":60},"state":${VALID_STATE_JSON}}`));
  const d = await validateTrade(validTrade, { hist_pnls: [] });
  expect(d.allowed).toBe(true);
});