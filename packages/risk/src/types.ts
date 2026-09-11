/**
 * Types du contrat JSON échangé avec la CLI Rust `risk-engine`.
 * Ces types miroitent `crates/risk-engine/src/*.rs` (serde derive).
 *
 * PALLAS-M04 : l'exécution n'acceptera plus un cast aveugle — les réponses
 * `invoke()` sont validées à l'exécution par les schémas Zod ci-dessous, qui
 * reflètent LE CONTRAT RÉEL de la CLI (main.rs, serde en snake_case).
 *
 * PALLAS-M15 (audit v0.3 F-04 §5, v0.2.1 P0-02/P0-03) : le `TradeRequest` est
 * une INTENTION sans limites. `bankroll_usd`/`max_order_usd`/`max_drawdown_usd`
 * ont quitté le payload appelant et vivent dans `RiskConfig` (configuration
 * opérateur, jamais reconstructible par la stratégie). L'exposition réelle
 * (positions + ordres ouverts, réconciliation M14) est transportée dans
 * `StateInput.exposure`.
 */

import { z } from 'zod';

/** Intention uniquement — aucune limite : voir doc-en-tête (PALLAS-M15). */
export interface TradeRequest {
  market_id: string;
  side: string;
  price: number;
  quantity: number;
  est_value_usd: number;
  win_probability: number;
  odds: number;
  confidence: number;
  /** Âge (ms) de l'orderbook qui construit cette décision — garde stale-price. */
  market_data_age_ms: number;
}

/**
 * Configuration de risque posssédée par l'OPERATEUR. La stratégie n'en
 * fournit AUCUN champ. Structurément alignée sur `RiskConfig` (pipeline.rs) ;
 * validée à l'exécution via `RiskConfigSchema` avant injection à la CLI.
 */
export interface RiskConfig {
  bankroll_usd: number;
  max_order_usd: number;
  max_portfolio_exposure_usd: number;
  max_drawdown_usd: number;
  max_concentration_usd: number;
  half_open_probe_size_usd: number;
  var_min_observations: number;
  var_startup_envelope_usd: number;
  max_market_data_age_ms: number;
}

/** Position ouverte / ordre ouvert — exposition réelle (réconciliation M14). */
export interface ExposureItem {
  market_id: string;
  size_usd: number;
  event_id?: string | null;
}

export type GateAction = 'Allow' | 'Reject';

export interface GateResult {
  gate: string;
  action: GateAction;
  reason: string;
}

export interface TradeDecision {
  allowed: boolean;
  gates: GateResult[];
  rejected_by: string[];
  suggested_size_usd: number;
}

export interface VaRResult {
  historical_var: number;
  parametric_var: number;
  cvar: number;
  confidence_level: number;
  sample_size: number;
  mean_pnl: number;
  std_dev: number;
  /** PALLAS-M15 (F-08) : ESTIMATED vs INSUFFICIENT_DATA — jamais risque nul silencieux. */
  status: 'ESTIMATED' | 'INSUFFICIENT_DATA';
}

export interface StateInput {
  hist_pnls: number[];
  kill_switch_engaged?: boolean;
  circuit_breaker?: CircuitBreakerState;
  volatility?: VolatilityState;
  /** Exposition réelle (positions + ordres ouverts) — PALLAS-M15. */
  exposure?: ExposureItem[];
}

/** Etat du circuit breaker (snapshot serialize par la CLI Rust). */
export interface CircuitBreakerState {
  state: 'Closed' | 'HalfOpen' | 'Open';
  consecutive_losses: number;
  cumulative_pnl: number;
  peak_pnl: number;
  since_trip: number;
}

/** Etat du detecteur de volatilite (snapshot serialize par la CLI Rust). */
export interface VolatilityState {
  window: number[];
  baseline: number | null;
}

/** Etat persistant retourne par la CLI pour que l'appelant le persiste. */
export interface StateOutput {
  hist_pnls: number[];
  kill_switch_engaged: boolean;
  circuit_breaker: CircuitBreakerState;
  volatility: VolatilityState;
  /** Exposition réelle (positions + ordres ouverts) — PALLAS-M15. */
  exposure: ExposureItem[];
}

export interface ValidateResponse {
  decision: TradeDecision;
  state: StateOutput;
}

export interface RecordResponse {
  state: StateOutput;
}

export interface VarResponse {
  var: VaRResult;
}

export interface ErrorResponse {
  error: string;
}

// --- Schémas Zod du contrat CLI (PALLAS-M04) — vérifiés à l'exécution, pas de cast aveugle ---

export const ErrorResponseSchema = z.object({ error: z.string().min(1) }).strict();

export const GateResultSchema: z.ZodType<GateResult> = z
  .object({
    gate: z.string(),
    action: z.enum(['Allow', 'Reject']),
    reason: z.string(),
  })
  .strict();

export const TradeDecisionSchema: z.ZodType<TradeDecision> = z
  .object({
    allowed: z.boolean(),
    gates: z.array(GateResultSchema),
    rejected_by: z.array(z.string()),
    suggested_size_usd: z.number().finite(),
  })
  .strict();

export const CircuitBreakerStateSchema: z.ZodType<CircuitBreakerState> = z
  .object({
    state: z.enum(['Closed', 'HalfOpen', 'Open']),
    consecutive_losses: z.number().nonnegative(),
    cumulative_pnl: z.number().finite(),
    peak_pnl: z.number().finite(),
    since_trip: z.number().nonnegative(),
  })
  .strict();

export const ExposureItemSchema: z.ZodType<ExposureItem> = z
  .object({
    market_id: z.string().min(1),
    size_usd: z.number().finite().nonnegative(),
    event_id: z.string().nullish(),
  })
  .strict();

/** Configuration de risque OPERATEUR (PALLAS-M15) — validée avant injection CLI. */
export const RiskConfigSchema: z.ZodType<RiskConfig> = z
  .object({
    bankroll_usd: z.number().finite().positive(),
    max_order_usd: z.number().finite().positive(),
    max_portfolio_exposure_usd: z.number().finite().positive(),
    max_drawdown_usd: z.number().finite().positive(),
    max_concentration_usd: z.number().finite().positive(),
    half_open_probe_size_usd: z.number().finite().nonnegative(),
    var_min_observations: z.number().int().nonnegative(),
    var_startup_envelope_usd: z.number().finite().nonnegative(),
    max_market_data_age_ms: z.number().finite().nonnegative(),
  })
  .strict();

export const VolatilityStateSchema: z.ZodType<VolatilityState> = z
  .object({
    window: z.array(z.number().finite()),
    baseline: z.number().finite().nullable(),
  })
  .strict();

export const StateOutputSchema: z.ZodType<StateOutput> = z
  .object({
    hist_pnls: z.array(z.number().finite()),
    kill_switch_engaged: z.boolean(),
    circuit_breaker: CircuitBreakerStateSchema,
    volatility: VolatilityStateSchema,
    exposure: z.array(ExposureItemSchema),
  })
  .strict();

export const VaRResultSchema: z.ZodType<VaRResult> = z
  .object({
    historical_var: z.number().finite(),
    parametric_var: z.number().finite(),
    cvar: z.number().finite(),
    confidence_level: z.number().finite(),
    sample_size: z.number().nonnegative(),
    mean_pnl: z.number().finite(),
    std_dev: z.number().finite(),
    status: z.enum(['ESTIMATED', 'INSUFFICIENT_DATA']),
  })
  .strict();

export const ValidateResponseSchema: z.ZodType<ValidateResponse> = z
  .object({
    decision: TradeDecisionSchema,
    state: StateOutputSchema,
  })
  .strict();

export const VarResponseSchema: z.ZodType<VarResponse> = z
  .object({ var: VaRResultSchema })
  .strict();

export const RecordResponseSchema: z.ZodType<RecordResponse> = z
  .object({ state: StateOutputSchema })
  .strict();
