//! CLI du risk engine.
//!
//! Contrat : un objet JSON sur stdin, un objet JSON sur stdout.
//!
//! ```json
//! { "command": "validate", "trade": { ... }, "state": { "hist_pnls": [...] } }
//! { "command": "var", "pnls": [...], "confidence": 0.95 }
//! ```
//!
//! Sorties :
//! - validate -> { "decision": { "allowed": bool, "gates": [...], "rejected_by": [...], "suggested_size_usd": n }, "error": null }
//! - var -> { "var": { "historical_var": n, ... }, "error": null }
//!
//! En cas d'erreur d'analyse, { "error": "message" } avec code de sortie non-zero.

use std::io::{self, Read, Write};

use risk_engine::pipeline::{validate_trade, RiskState, TradeRequest};
use risk_engine::var::calculate_at;

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
}

#[derive(Debug, Deserialize, Default)]
struct StateInput {
    #[serde(rename = "hist_pnls", default)]
    hist_pnls: Vec<f64>,
}

#[derive(Debug, Serialize)]
struct VarOutput {
    var: risk_engine::var::VaRResult,
}

#[derive(Debug, Serialize)]
struct DecisionOutput {
    decision: risk_engine::pipeline::TradeDecision,
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
            let mut state = RiskState::new();
            state.hist_pnls = state_input.hist_pnls;
            let decision = validate_trade(&trade, &state);
            serde_json::to_string(&DecisionOutput { decision })
                .map_err(|e| format!("serialize error: {e}"))
        }
        "var" => {
            let pnls = input.pnls.ok_or("missing 'pnls'")?;
            let confidence = input.confidence.unwrap_or(0.95);
            let var = calculate_at(&pnls, confidence);
            serde_json::to_string(&VarOutput { var }).map_err(|e| format!("serialize error: {e}"))
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
