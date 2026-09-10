//! CLI du risk engine.
//!
//! Contrat : un objet JSON sur stdin, un objet JSON sur stdout.
//!
//! ```json
//! { "command": "validate", "trade": { ... }, "state": { "hist_pnls": [...], "kill_switch_engaged": false, "circuit_breaker": {...}, "volatility": {...} } }
//! { "command": "var", "pnls": [...], "confidence": 0.95 }
//! { "command": "record", "state": { ... }, "pnl": -12.5 }
//! ```
//!
//! Sorties :
//! - validate -> { "decision": { "allowed": bool, "gates": [...], "rejected_by": [...], "suggested_size_usd": n }, "state": { ... }, "error": null }
//! - var -> { "var": { "historical_var": n, ... }, "error": null }
//! - record -> { "state": { ... }, "error": null }
//!
//! En cas d'erreur d'analyse, { "error": "message" } avec code de sortie non-zero.
//!
//! L'etat (circuit breaker, volatilite, kill switch, historiques) est transporte
//! a CHAQUE appel par l'appelant (processeur TS) et persiste entre deux appels.

use std::io::{self, Read, Write};

use risk_engine::circuit_breaker::CircuitBreakerSnapshot;
use risk_engine::pipeline::{validate_trade, RiskState, TradeRequest};
use risk_engine::var::calculate_at;
use risk_engine::volatility::VolatilityState;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct Input {
    #[serde(rename = "command")]
    command: String,
    #[serde(rename = "trade")]
    trade: Option<TradeRequest>,
    #[serde(rename = "state")]
    state: Option<StateInput>,
    #[serde(rename = "pnls")]
    pnls: Option<Vec<f64>>,
    #[serde(rename = "confidence")]
    confidence: Option<f64>,
    #[serde(rename = "pnl")]
    pnl: Option<f64>,
}

/// Etat persistant tel que transporte par l'appelant entre deux appels CLI.
#[derive(Debug, Deserialize, Default)]
struct StateInput {
    #[serde(rename = "hist_pnls", default)]
    hist_pnls: Vec<f64>,
    #[serde(rename = "kill_switch_engaged", default)]
    kill_switch_engaged: bool,
    #[serde(rename = "circuit_breaker")]
    circuit_breaker: Option<CircuitBreakerSnapshot>,
    #[serde(rename = "volatility")]
    volatility: Option<VolatilityState>,
}

/// Etat retransmis en sortie pour que l'appelant le persiste tel quel.
#[derive(Debug, Serialize)]
struct StateOutput {
    #[serde(rename = "hist_pnls")]
    hist_pnls: Vec<f64>,
    #[serde(rename = "kill_switch_engaged")]
    kill_switch_engaged: bool,
    #[serde(rename = "circuit_breaker")]
    circuit_breaker: CircuitBreakerSnapshot,
    #[serde(rename = "volatility")]
    volatility: VolatilityState,
}

fn build_state(input: StateInput) -> RiskState {
    let mut state = RiskState::new();
    state.hist_pnls = input.hist_pnls;
    state.kill_switch_engaged = input.kill_switch_engaged;
    if let Some(cb) = input.circuit_breaker {
        state.circuit_breaker.restore(&cb);
    }
    if let Some(v) = input.volatility {
        state.volatility.restore(&v);
    }
    state
}

fn state_output(state: &RiskState) -> StateOutput {
    StateOutput {
        hist_pnls: state.hist_pnls.clone(),
        kill_switch_engaged: state.kill_switch_engaged,
        circuit_breaker: state.circuit_breaker.snapshot(),
        volatility: state.volatility.snapshot(),
    }
}

#[derive(Debug, Serialize)]
struct VarOutput {
    var: risk_engine::var::VaRResult,
}

#[derive(Debug, Serialize)]
struct DecisionOutput {
    decision: risk_engine::pipeline::TradeDecision,
    state: StateOutput,
}

#[derive(Debug, Serialize)]
struct RecordOutput {
    state: StateOutput,
}

#[derive(Debug, Serialize)]
struct ErrorOutput {
    error: String,
}

fn run(input: Input) -> Result<String, String> {
    match input.command.as_str() {
        "validate" => {
            let trade = input.trade.ok_or("missing 'trade'")?;
            let state_input = input.state.unwrap_or_default();
            let state = build_state(state_input);
            let decision = validate_trade(&trade, &state);
            serde_json::to_string(&DecisionOutput {
                decision,
                state: state_output(&state),
            })
            .map_err(|e| format!("serialize error: {e}"))
        }
        "var" => {
            let pnls = input.pnls.ok_or("missing 'pnls'")?;
            let confidence = input.confidence.unwrap_or(0.95);
            let var = calculate_at(&pnls, confidence);
            serde_json::to_string(&VarOutput { var }).map_err(|e| format!("serialize error: {e}"))
        }
        "record" => {
            let pnl = input.pnl.ok_or("missing 'pnl'")?;
            if !pnl.is_finite() {
                return Err("pnl must be a finite number".to_string());
            }
            let state_input = input.state.unwrap_or_default();
            let mut state = build_state(state_input);
            state.circuit_breaker.record_pnl(pnl);
            state.volatility.add(pnl);
            serde_json::to_string(&RecordOutput { state: state_output(&state) })
                .map_err(|e| format!("serialize error: {e}"))
        }
        other => Err(format!("unknown command: {other}")),
    }
}

fn main() {
    let mut buf = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut buf) {
        let out = serde_json::to_string(&ErrorOutput { error: format!("read error: {e}") }).unwrap();
        eprintln!("{out}");
        std::process::exit(1);
    }

    let input: Input = match serde_json::from_str(&buf) {
        Ok(i) => i,
        Err(e) => {
            let out =
                serde_json::to_string(&ErrorOutput { error: format!("parse error: {e}") }).unwrap();
            eprintln!("{out}");
            std::process::exit(1);
        }
    };

    match run(input) {
        Ok(json) => {
            let mut out = io::stdout();
            let _ = out.write_all(json.as_bytes());
            let _ = out.write_all(b"\n");
        }
        Err(msg) => {
            let out = serde_json::to_string(&ErrorOutput { error: msg }).unwrap();
            eprintln!("{out}");
            std::process::exit(1);
        }
    }
}
