/**
 * Types du contrat JSON échangé avec la CLI Rust `risk-engine`.
 * Ces types miroitent `crates/risk-engine/src/*.rs` (serde derive).
 */

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
}

export interface ValidateResponse {
  decision: TradeDecision;
}

export interface VarResponse {
  var: VaRResult;
}

export interface ErrorResponse {
  error: string;
}
