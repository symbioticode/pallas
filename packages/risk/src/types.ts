/**
 * Types du contrat JSON échangé avec la CLI Rust `risk-engine`.
 * Ces types miroitent `crates/risk-engine/src/*.rs` (serde derive).
 *
 * PALLAS-M04 : l'exécution n'acceptera plus un cast aveugle — les réponses
 * `invoke()` sont validées à l'exécution par les schémas Zod ci-dessous, qui
 * reflètent LE CONTRAT RÉEL de la CLI (main.rs, serde en snake_case).
 */

import { z } from 'zod';

export interface TradeRequest {
  market_id: string;
  side: string;
  price: number;
  quantity: number;
  est_value_usd: number;
  win_probability: number;
  odds: number;
  bankroll_usd: number;
  confidence: number;
  max_order_usd: number;
  max_drawdown_usd: number;
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
}

export interface StateInput {
  hist_pnls: number[];
  kill_switch_engaged?: boolean;
  circuit_breaker?: CircuitBreakerState;
  volatility?: VolatilityState;
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
