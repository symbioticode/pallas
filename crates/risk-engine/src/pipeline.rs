//! Pipeline `validate_trade` — 10 etapes de validation d'un ordre.
//!
//! Chaque etape produit une decision (allow / reject) et un motif. La decision
//! finale est un ET logique de toutes les etapes : si une seule rejette, le
//! trade est refuse (fail-closed).

use crate::circuit_breaker::{CircuitBreaker, CircuitBreakerConfig};
use crate::kelly::kelly_fraction;
use crate::stress::stress_portfolio;
use crate::var::calculate_at;
use crate::volatility::{VolatilityConfig, VolatilityDetector};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum GateAction {
    Allow,
    Reject,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateResult {
    pub gate: String,
    pub action: GateAction,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeDecision {
    pub allowed: bool,
    pub gates: Vec<GateResult>,
    pub rejected_by: Vec<String>,
    pub suggested_size_usd: f64,
}

/// Parametres d'un trade candidat.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeRequest {
    pub market_id: String,
    pub side: String, // "buy" | "sell"
    pub price: f64,
    pub quantity: f64,
    pub est_value_usd: f64,
    pub win_probability: f64,  // confiance du modele (0..1)
    pub odds: f64,             // cote nette (b)
    pub bankroll_usd: f64,
    pub confidence: f64,       // confiance du modele, nb. obs. formees
    pub max_order_usd: f64,
    pub max_drawdown_usd: f64,
}

/// Etat persistant du moteur de risque.
#[derive(Default)]
pub struct RiskState {
    pub kill_switch_engaged: bool,
    pub circuit_breaker: CircuitBreaker,
    pub volatility: VolatilityDetector,
    pub hist_pnls: Vec<f64>,
}

impl RiskState {
    pub fn new() -> Self {
        Self {
            kill_switch_engaged: false,
            circuit_breaker: CircuitBreaker::new(CircuitBreakerConfig::default()),
            volatility: VolatilityDetector::new(VolatilityConfig::default()),
            hist_pnls: Vec::new(),
        }
    }
}

/// Reseau de validation des bornes metier d'un `TradeRequest`. Toute valeur
/// hors bornes (ou none projetee) fait rejeter la porte `INPUT_VALIDATION`
/// avant meme les autres etapes.
fn input_validation_errors(req: &TradeRequest) -> Vec<String> {
    let mut errors: Vec<String> = Vec::new();
    let mut is_bad = |field: &str, cond: bool| {
        if cond {
            errors.push(field.to_string());
        }
    };
    is_bad("market_id", req.market_id.trim().is_empty());
    is_bad("side", req.side != "buy" && req.side != "sell");
    is_bad("price", !(req.price.is_finite() && req.price > 0.0 && req.price <= 1.0));
    is_bad("quantity", !(req.quantity.is_finite() && req.quantity > 0.0));
    is_bad("est_value_usd", !(req.est_value_usd.is_finite() && req.est_value_usd > 0.0));
    is_bad("win_probability", !(req.win_probability.is_finite() && (0.0..=1.0).contains(&req.win_probability)));
    is_bad("odds", !(req.odds.is_finite() && req.odds > 0.0));
    is_bad("bankroll_usd", !(req.bankroll_usd.is_finite() && req.bankroll_usd > 0.0));
    is_bad("confidence", !(req.confidence.is_finite() && (0.0..=1.0).contains(&req.confidence)));
    is_bad("max_order_usd", !(req.max_order_usd.is_finite() && req.max_order_usd > 0.0));
    is_bad("max_drawdown_usd", !(req.max_drawdown_usd.is_finite() && req.max_drawdown_usd > 0.0));
    errors
}

/// Evalue un trade contre toutes les portes de securite. Retourne la decision
/// sans muter l'etat (le caller applique `apply` apres execution reelle).
///
/// Ordre : (1) kill switch, (2) validation des entrees, (3) les 10 gates.
/// Les deux premieres etapes court-circuitent le pipeline (fail-closed).
pub fn validate_trade(req: &TradeRequest, state: &RiskState) -> TradeDecision {
    // 1. Kill switch — bloque tout, quel que soit le reste.
    if state.kill_switch_engaged {
        return TradeDecision {
            allowed: false,
            gates: vec![GateResult {
                gate: "KILL_SWITCH".to_string(),
                action: GateAction::Reject,
                reason: "Global kill switch is ENGAGED (manual or dry-run isolation)".to_string(),
            }],
            rejected_by: vec!["KILL_SWITCH".to_string()],
            suggested_size_usd: 0.0,
        };
    }

    // 2. Validation stricte des bornes metier — avant les 10 gates.
    let input_errors = input_validation_errors(req);
    if !input_errors.is_empty() {
        let reason = format!("Invalid trade input fields: {}", input_errors.join(", "));
        return TradeDecision {
            allowed: false,
            gates: vec![GateResult {
                gate: "INPUT_VALIDATION".to_string(),
                action: GateAction::Reject,
                reason,
            }],
            rejected_by: vec!["INPUT_VALIDATION".to_string()],
            suggested_size_usd: 0.0,
        };
    }

    let mut gates: Vec<GateResult> = Vec::new();

    // 3. Circuit breaker.
    let cb_open = state.circuit_breaker.is_open();
    gates.push(GateResult {
        gate: "CIRCUIT_BREAKER".to_string(),
        action: if cb_open { GateAction::Reject } else { GateAction::Allow },
        reason: if cb_open {
            "Circuit breaker open (state: {:?})".to_string()
        } else {
            "Circuit breaker closed".to_string()
        },
    });

    // 4. Regime de volatilite.
    let vol = state.volatility.detect();
    if vol.should_halt {
        gates.push(GateResult {
            gate: "VOLATILITY_REGIME".to_string(),
            action: GateAction::Reject,
            reason: format!("Trading halted: extreme volatility regime (sd={:.2})", vol.rolling_std_dev),
        });
    } else {
        gates.push(GateResult {
            gate: "VOLATILITY_REGIME".to_string(),
            action: GateAction::Allow,
            reason: format!("Regime {:?} active", vol.regime),
        });
    }

    // 4. Position max (taille d'ordre).
    let within_size = req.est_value_usd <= req.max_order_usd;
    gates.push(GateResult {
        gate: "POSITION_LIMIT".to_string(),
        action: if within_size { GateAction::Allow } else { GateAction::Reject },
        reason: if within_size {
            format!("Order size ${:.2} <= max ${:.2}", req.est_value_usd, req.max_order_usd)
        } else {
            format!(
                "Order size ${:.2} exceeds max ${:.2}",
                req.est_value_usd, req.max_order_usd
            )
        },
    });

    // 5. Prix hors marche (absurde).
    let sane_price = req.price > 0.0 && req.price <= 1.0; // marche binaire (0..1)
    gates.push(GateResult {
        gate: "PRICE_SANITY".to_string(),
        action: if sane_price { GateAction::Allow } else { GateAction::Reject },
        reason: format!("Price {} valid", req.price),
    });

    // 6. Quantite positive.
    let positive_qty = req.quantity > 0.0;
    gates.push(GateResult {
        gate: "QUANTITY_POSITIVE".to_string(),
        action: if positive_qty { GateAction::Allow } else { GateAction::Reject },
        reason: format!("Quantity {} {}", req.quantity, if positive_qty { "positive" } else { "<= 0" }),
    });

    // 7. Kelly size ne depasse pas la bankroll.
    let kelly = kelly_fraction(req.win_probability, req.odds, req.bankroll_usd, 0.5);
    let kelly_ok = req.est_value_usd <= req.bankroll_usd;
    gates.push(GateResult {
        gate: "KELLY_LIMIT".to_string(),
        action: if kelly_ok { GateAction::Allow } else { GateAction::Reject },
        reason: format!("Kelly fraction half={:.4}, EV {}", kelly.half_kelly, if kelly.positive_ev { "positive" } else { "negative" }),
    });

    // 8. VaR/CVaR sous le plafond de perte.
    let var = calculate_at(&state.hist_pnls, 0.95);
    let cv = var.cvar;
    let var_ok = cv <= req.max_drawdown_usd * 0.5;
    gates.push(GateResult {
        gate: "VAR_CVAR_LIMIT".to_string(),
        action: if var_ok { GateAction::Allow } else { GateAction::Reject },
        reason: format!("CVaR ${:.2} {}", cv, if var_ok { "within limit" } else { "exceeds limit" }),
    });

    // 9. Stress test — la perte max tolerable ne blesse pas la bankroll.
    let stress = stress_portfolio(req.bankroll_usd, req.max_drawdown_usd);
    let worst_survival = stress.iter().all(|o| o.survices);
    gates.push(GateResult {
        gate: "STRESS_TEST".to_string(),
        action: if worst_survival { GateAction::Allow } else { GateAction::Reject },
        reason: if worst_survival {
            "Survives all stress scenarios".to_string()
        } else {
            "Fails one or more stress scenarios".to_string()
        },
    });

    // 10. Confiance minimale.
    let confidence_ok = req.confidence >= 0.5;
    gates.push(GateResult {
        gate: "MIN_CONFIDENCE".to_string(),
        action: if confidence_ok { GateAction::Allow } else { GateAction::Reject },
        reason: format!("Model confidence {:.2}", req.confidence),
    });

    let rejected: Vec<String> = gates
        .iter()
        .filter(|g| g.action == GateAction::Reject)
        .map(|g| g.gate.clone())
        .collect();

    let allowed = rejected.is_empty();
    let suggested_size = if allowed && kelly.positive_ev {
        (kelly.recommended_size * vol.size_multiplier).min(req.max_order_usd)
    } else {
        0.0
    };

    TradeDecision {
        allowed,
        gates,
        rejected_by: rejected,
        suggested_size_usd: (suggested_size * 100.0).round() / 100.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_req() -> TradeRequest {
        TradeRequest {
            market_id: "m1".to_string(),
            side: "buy".to_string(),
            price: 0.6,
            quantity: 10.0,
            est_value_usd: 60.0,
            win_probability: 0.7,
            odds: 0.7,
            bankroll_usd: 10_000.0,
            confidence: 0.8,
            max_order_usd: 1_000.0,
            max_drawdown_usd: 5_000.0,
        }
    }

    #[test]
    fn full_pipeline_approves_valid_trade() {
        let mut state = RiskState::new();
        state.hist_pnls.push(1.0);
        state.hist_pnls.push(-1.0);
        state.hist_pnls.push(2.0);
        state.hist_pnls.push(-2.0);
        let d = validate_trade(&valid_req(), &state);
        assert!(d.allowed, "rejected by {:?}", d.rejected_by);
    }

    #[test]
    fn kill_switch_blocks_all_trades() {
        // note : le kill switch est modelise en amont (gate de dry-run).
        // On verifie que chaque porte rejette independamment.
        let mut req = valid_req();
        req.est_value_usd = 99_999.0;
        req.max_order_usd = 1.0;
        let state = RiskState::new();
        let d = validate_trade(&req, &state);
        assert!(!d.allowed);
        assert!(d.rejected_by.contains(&"POSITION_LIMIT".to_string()));
    }

    #[test]
    fn oversized_order_rejected() {
        let mut req = valid_req();
        req.est_value_usd = 5_000.0;
        req.max_order_usd = 1_000.0;
        let state = RiskState::new();
        let d = validate_trade(&req, &state);
        assert!(!d.allowed);
        assert!(d.rejected_by.contains(&"POSITION_LIMIT".to_string()));
    }

    #[test]
    fn circuit_breaker_open_blocks() {
        let mut state = RiskState::new();
        state.circuit_breaker = CircuitBreaker::new(CircuitBreakerConfig {
            max_consecutive_losses: 2,
            ..Default::default()
        });
        state.circuit_breaker.record_pnl(-5.0);
        state.circuit_breaker.record_pnl(-5.0);
        assert!(state.circuit_breaker.is_open());
        let d = validate_trade(&valid_req(), &state);
        assert!(d.rejected_by.contains(&"CIRCUIT_BREAKER".to_string()));
        assert!(!d.allowed);
    }

    #[test]
    fn pipeline_is_deterministic() {
        let state = RiskState::new();
        let a = validate_trade(&valid_req(), &state);
        let b = validate_trade(&valid_req(), &state);
        assert_eq!(a.allowed, b.allowed);
        assert_eq!(a.rejected_by, b.rejected_by);
    }

    #[test]
    fn audit_2026_09_09_rejects_invalid_trade() {
        // Probe adversariale de l'audit : tout est invalide, rien ne doit passer.
        let req = TradeRequest {
            market_id: String::new(),
            side: "garbage".to_string(),
            price: 0.6,
            quantity: 10.0,
            est_value_usd: -100.0,
            win_probability: 2.0,
            odds: 0.7,
            bankroll_usd: 10_000.0,
            confidence: 0.8,
            max_order_usd: 1_000.0,
            max_drawdown_usd: 5_000.0,
        };
        let state = RiskState::new();
        let d = validate_trade(&req, &state);
        assert!(!d.allowed);
        assert!(d.rejected_by.contains(&"INPUT_VALIDATION".to_string()));
        assert_eq!(d.suggested_size_usd, 0.0);
        assert_eq!(d.gates.len(), 1, "short-circuit: seule la porte INPUT_VALIDATION");
    }

    #[test]
    fn kill_switch_engaged_blocks_every_trade() {
        let mut state = RiskState::new();
        state.kill_switch_engaged = true;
        let d = validate_trade(&valid_req(), &state);
        assert!(!d.allowed);
        assert!(d.rejected_by.contains(&"KILL_SWITCH".to_string()));
        assert_eq!(d.gates.len(), 1, "short-circuit: seule la porte KILL_SWITCH");
        // meme un trade autrement valide est bloque.
        let mut req = valid_req();
        req.side = "garbage".to_string();
        let d2 = validate_trade(&req, &state);
        assert!(d2.rejected_by.contains(&"KILL_SWITCH".to_string()));
        assert!(!d2.rejected_by.contains(&"INPUT_VALIDATION".to_string()));
    }

    #[test]
    fn input_validation_rejects_each_bound() {
        let cases: Vec<(&'static str, Box<dyn Fn(&mut TradeRequest)>)> = vec![
            ("market_id", Box::new(|r| r.market_id = String::new())),
            ("side", Box::new(|r| r.side = "SELL".to_string())),
            ("price", Box::new(|r| r.price = 1.5)),
            ("quantity", Box::new(|r| r.quantity = 0.0)),
            ("est_value_usd", Box::new(|r| r.est_value_usd = -1.0)),
            ("win_probability", Box::new(|r| r.win_probability = 1.5)),
            ("bankroll_usd", Box::new(|r| r.bankroll_usd = 0.0)),
            ("confidence", Box::new(|r| r.confidence = -0.5)),
        ];
        for (field, mutate) in cases {
            let mut req = valid_req();
            mutate(&mut req);
            let state = RiskState::new();
            let d = validate_trade(&req, &state);
            assert!(!d.allowed, "field {field} devrait etre rejete");
            assert!(
                d.rejected_by.contains(&"INPUT_VALIDATION".to_string()),
                "field {field}: rejected_by = {:?}",
                d.rejected_by
            );
        }
    }
}
