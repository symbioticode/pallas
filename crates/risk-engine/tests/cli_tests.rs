//! Tests d'integration de la CLI via la librairie + executions de la binaire.

use std::io::Write;
use std::process::{Command, Stdio};

use risk_engine::kelly::kelly_fraction;
use risk_engine::pipeline::validate_trade;
use risk_engine::pipeline::RiskConfig;
use risk_engine::pipeline::RiskState;
use risk_engine::pipeline::TradeRequest;
use risk_engine::var::var_historical;

fn spawn_cli() -> Command {
    // La binaire de test est nommée risk-engine ; cargo met CARGO_BIN_EXE_...
    let exe = env!("CARGO_BIN_EXE_risk-engine");
    Command::new(exe)
}

/// Execute la CLI avec `input_json` sur stdin et retourne le JSON stdout parse.
fn run_cli(input_json: &str) -> serde_json::Value {
    let mut child = spawn_cli()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn cli");
    {
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(input_json.as_bytes()).unwrap();
    } // drop -> ferme stdin
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_str(&String::from_utf8_lossy(&output.stdout)).expect("stdout JSON valide")
}

fn valid_trade_json() -> serde_json::Value {
    serde_json::json!({
        "market_id": "m1",
        "side": "buy",
        "price": 0.6,
        "quantity": 10.0,
        "est_value_usd": 6.0, // coherent : price * quantity = 6 (M09)
        "win_probability": 0.7,
        "odds": 0.7,
        "confidence": 0.8,
        "market_data_age_ms": 0.0, // donnees fraiches (PALLAS-M15)
    })
}

#[test]
fn cli_var_returns_json() {
    let mut child = spawn_cli()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn cli");
    let mut stdin = child.stdin.take().unwrap();
    stdin
        .write_all(br#"{"command":"var","pnls":[1.0,-1.0,2.0,-2.0],"confidence":0.95}"#)
        .unwrap();
    drop(stdin);
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "stdout: {}", String::from_utf8_lossy(&output.stdout));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("\"historical_var\""));
    assert!(text.contains("\"cvar\""));
}

#[test]
fn cli_validate_returns_decision() {
    let mut child = spawn_cli()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn cli");
    let mut stdin = child.stdin.take().unwrap();
    let req = TradeRequest {
        market_id: "m1".to_string(),
        side: "buy".to_string(),
        price: 0.6,
        quantity: 10.0,
        est_value_usd: 6.0, // coherent : price * quantity = 6 (M09)
        win_probability: 0.7,
        odds: 0.7,
        confidence: 0.8,
        market_data_age_ms: 0.0,
    };
    let input = serde_json::json!({
        "command": "validate",
        "trade": req,
        "state": { "hist_pnls": [1.0, -1.0, 2.0] }
    });
    stdin.write_all(input.to_string().as_bytes()).unwrap();
    drop(stdin);
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "stdout: {}", String::from_utf8_lossy(&output.stdout));
    let text = String::from_utf8(output.stdout).unwrap();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["decision"]["allowed"], true);
    assert_eq!(v["decision"]["rejected_by"].as_array().unwrap().len(), 0);
}

#[test]
fn cli_invalid_command_errors() {
    let mut child = spawn_cli()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn cli");
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(br#"{"command":"bogus"}"#).unwrap();
    drop(stdin);
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success());
    let err = String::from_utf8_lossy(&output.stderr);
    assert!(err.contains("unknown command"));
}

// --- liens entre modules (coherence) ---

#[test]
fn decision_and_kelly_agree_on_positive_ev() {
    let k = kelly_fraction(0.7, 0.7, 10_000.0, 0.5);
    assert!(k.positive_ev);
    assert!(k.recommended_size > 0.0);
}

#[test]
fn var_historical_bounded() {
    let pnls = vec![-5.0, -8.0, -2.0, -12.0, -1.0];
    let v = var_historical(&pnls, 0.95);
    assert!((0.0..=15.0).contains(&v));
}

#[test]
fn full_pipeline_integrates() {
    let mut state = RiskState::new();
    let _ = &mut state;
    let req = TradeRequest {
        market_id: "x".to_string(),
        side: "sell".to_string(),
        price: 0.4,
        quantity: 5.0,
        est_value_usd: 2.0, // coherent : 0.4 * 5 = 2 (avant M09 : 100.0, incoherent)
        win_probability: 0.6,
        odds: 1.5,
        confidence: 0.9,
        market_data_age_ms: 0.0,
    };
    // PALLAS-M15 : les limites viennent de la CONFIGURATION, plus du trade.
    let config = RiskConfig {
        bankroll_usd: 20_000.0,
        max_order_usd: 500.0,
        max_portfolio_exposure_usd: 500.0,
        max_drawdown_usd: 8_000.0,
        max_concentration_usd: 500.0,
        ..Default::default()
    };
    let d = validate_trade(&req, &state, &config);
    assert!(d.allowed, "rejected_by={:?}", d.rejected_by);
}

// --- PALLAS-M15 : frontiere d'intention — limite mais POINTE sur le contrat ---

#[test]
fn cli_rejects_legacy_limit_fields_in_trade() {
    // Une strategie qui enverrait encore bankroll_usd/max_order_usd/
    // max_drawdown_usd est REFUSEE a la deserialisation (deny_unknown_fields) :
    // la frontiere est explicite, jamais un silence dangereux. Fail-closed.
    let input = serde_json::json!({
        "command": "validate",
        "trade": {
            "market_id": "m1",
            "side": "buy",
            "price": 0.6,
            "quantity": 10.0,
            "est_value_usd": 6.0,
            "win_probability": 0.7,
            "odds": 0.7,
            "confidence": 0.8,
            "market_data_age_ms": 0.0,
            "bankroll_usd": 1_000_000.0, // tenter d'elargir l'enveloppe
        },
        "state": { "hist_pnls": [] }
    });
    let mut child = spawn_cli()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn cli");
    child.stdin.take().unwrap().write_all(input.to_string().as_bytes()).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success(), "champ limite legacy doit etre refuse");
    let err = String::from_utf8_lossy(&output.stderr);
    assert!(err.contains("unknown field"), "stderr: {err}");
}

#[test]
fn cli_config_owns_limits() {
    // Le MEME trade valide est refusé ou accepté selon la CONFIG, pas selon le payload.
    let tight = serde_json::json!({
        "command": "validate",
        "trade": valid_trade_json(),
        "config": { "bankroll_usd": 10_000.0, "max_order_usd": 1.0, "max_portfolio_exposure_usd": 1.0, "max_drawdown_usd": 5000.0, "max_concentration_usd": 1.0, "half_open_probe_size_usd": 0.5, "var_min_observations": 2, "var_startup_envelope_usd": 1.0, "max_market_data_age_ms": 600000.0 },
        "state": { "hist_pnls": [1.0, -1.0] }
    });
    let out_tight = run_cli(&tight.to_string());
    assert_eq!(out_tight["decision"]["allowed"], false);
    let rejected = out_tight["decision"]["rejected_by"].as_array().unwrap();
    assert!(rejected.iter().any(|g| g == "POSITION_LIMIT"));

    let loose = serde_json::json!({
        "command": "validate",
        "trade": valid_trade_json(),
        "config": { "bankroll_usd": 10_000.0, "max_order_usd": 1_000.0, "max_portfolio_exposure_usd": 1_000.0, "max_drawdown_usd": 5000.0, "max_concentration_usd": 1_000.0, "half_open_probe_size_usd": 50.0, "var_min_observations": 2, "var_startup_envelope_usd": 1_000.0, "max_market_data_age_ms": 600000.0 },
        "state": { "hist_pnls": [1.0, -1.0] }
    });
    let out_loose = run_cli(&loose.to_string());
    assert_eq!(out_loose["decision"]["allowed"], true);
}

#[test]
fn cli_exposure_is_transported_and_limits_cumulative() {
    // L'exposition reelle (reconciliation PALLAS-M14) est transportee dans
    // l'etat et borne les ordres suivants (P0-02 / F-04).
    let input = serde_json::json!({
        "command": "validate",
        "trade": valid_trade_json(),
        "config": { "bankroll_usd": 10_000.0, "max_order_usd": 1_000.0, "max_portfolio_exposure_usd": 10.0, "max_drawdown_usd": 5000.0, "max_concentration_usd": 1_000.0, "half_open_probe_size_usd": 50.0, "var_min_observations": 2, "var_startup_envelope_usd": 1_000.0, "max_market_data_age_ms": 600000.0 },
        "state": { "hist_pnls": [1.0, -1.0], "exposure": [ { "market_id": "m1", "size_usd": 8.0 } ] }
    });
    let out = run_cli(&input.to_string());
    assert_eq!(out["decision"]["allowed"], false, "8 + 6 = 14 > 10");
    let rejected = out["decision"]["rejected_by"].as_array().unwrap();
    assert!(rejected.iter().any(|g| g == "POSITION_LIMIT"));
}

// --- M01 : etat persistant transporte entre appels CLI ---

#[test]
fn cli_validate_returns_state_for_persistence() {
    let input = serde_json::json!({
        "command": "validate",
        "trade": valid_trade_json(),
        "state": { "hist_pnls": [1.0, -1.0] }
    });
    let out = run_cli(&input.to_string());
    assert_eq!(out["decision"]["allowed"], true);
    // La sortie transporte l'etat pour que l'appelant le persiste.
    assert!(out["state"]["hist_pnls"].is_array());
    assert_eq!(out["state"]["kill_switch_engaged"], false);
    assert!(out["state"]["circuit_breaker"]["state"] == "Closed");
    assert!(out["state"]["volatility"]["window"].is_array());
}

#[test]
fn cli_record_updates_breaker_state() {
    let input = serde_json::json!({
        "command": "record",
        "state": { "hist_pnls": [] },
        "pnl": -50.0
    });
    let out = run_cli(&input.to_string());
    assert_eq!(out["state"]["circuit_breaker"]["consecutive_losses"], 1);
    assert!(out["state"]["volatility"]["window"].as_array().is_some_and(|w| !w.is_empty()));
    // un second record avec etat transporte cumule la perte consecutive.
    let carried = out["state"].clone();
    let input2 = serde_json::json!({ "command": "record", "state": carried, "pnl": -50.0 });
    let out2 = run_cli(&input2.to_string());
    assert_eq!(out2["state"]["circuit_breaker"]["consecutive_losses"], 2);
}

#[test]
fn cli_consecutive_losses_trip_breaker_across_calls() {
    // Pertes consecutives reparties sur des appels CLI SEPARES (etat transmis).
    let mut state = serde_json::json!({ "hist_pnls": [] });
    for _ in 0..5 {
        let input = serde_json::json!({ "command": "record", "state": state, "pnl": -10.0 });
        let out = run_cli(&input.to_string());
        state = out["state"].clone();
    }
    assert_eq!(state["circuit_breaker"]["state"], "Open");

    let input = serde_json::json!({ "command": "validate", "trade": valid_trade_json(), "state": state });
    let out = run_cli(&input.to_string());
    assert_eq!(out["decision"]["allowed"], false);
    let rejected = out["decision"]["rejected_by"].as_array().unwrap();
    assert!(rejected.iter().any(|g| g == "CIRCUIT_BREAKER"));
}

#[test]
fn cli_kill_switch_blocks_every_trade() {
    let input = serde_json::json!({
        "command": "validate",
        "trade": valid_trade_json(),
        "state": { "hist_pnls": [], "kill_switch_engaged": true }
    });
    let out = run_cli(&input.to_string());
    assert_eq!(out["decision"]["allowed"], false);
    let rejected = out["decision"]["rejected_by"].as_array().unwrap();
    assert!(rejected.iter().any(|g| g == "KILL_SWITCH"));
    // argc court-circuit : une seule porte.
    assert_eq!(out["decision"]["gates"].as_array().unwrap().len(), 1);
}

#[test]
fn cli_audit_2026_09_09_rejects_invalid_trade() {
    // Probe adversariale de l'audit via le contrat CLI complet.
    let input = serde_json::json!({
        "command": "validate",
        "trade": {
            "market_id": "",
            "side": "garbage",
            "price": 0.6,
            "quantity": 10.0,
            "est_value_usd": -100.0,
            "win_probability": 2.0,
            "odds": 0.7,
            "confidence": 0.8,
            "market_data_age_ms": 0.0,
        },
        "state": { "hist_pnls": [] }
    });
    let out = run_cli(&input.to_string());
    assert_eq!(out["decision"]["allowed"], false);
    assert_eq!(out["decision"]["suggested_size_usd"], 0.0);
    let rejected = out["decision"]["rejected_by"].as_array().unwrap();
    assert!(rejected.iter().any(|g| g == "INPUT_VALIDATION"));
}

#[test]
fn cli_record_rejects_non_finite_pnl() {
    let input = serde_json::json!({
        "command": "record",
        "state": { "hist_pnls": [] },
        "pnl": "NaN"
    });
    // "NaN" JSON -> serde_json::from_str echec en phase de parse (exit non-zero).
    let mut child = spawn_cli()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn cli");
    child.stdin.take().unwrap().write_all(input.to_string().as_bytes()).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success(), "NaN doit etre refuse");
}
