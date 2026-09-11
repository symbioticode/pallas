//! Pipeline `validate_trade` — portes de validation d'un ordre.
//!
//! Chaque porte produit une decision (allow / reject) et un motif. La decision
//! finale est un ET logique de toutes les portes : si une seule rejette, le
//! trade est refuse (fail-closed).
//!
//! PALLAS-M15 (audit v0.3 F-04 §5, v0.2.1 P0-02/P0-03/P0-05/P1-03/P1-04) :
//! - les limites (`bankroll_usd`, `max_order_usd`, `max_drawdown_usd`, ...) ne
//!   viennent PLUS du `TradeRequest` (appelant) mais de la configuration
//!   operateur `RiskConfig` — la strategie ne peut pas elargir sa propre
//!   enveloppe d'un appel a l'autre. Le champ `TradeRequest` porte
//!   `deny_unknown_fields` : un appelant qui enverrait encore ces limites est
//!   REFUSE a la deserialisation (fail-closed, pas de silence).
//! - l'exposition reelle (positions + ordres ouverts, fournis par la
//!   reconciliation PALLAS-M14) vit dans `RiskState.exposure` et `POSITION_LIMIT`
//!   compare l'exposition APRÈS execution (cumulee), pas l'ordre isole.
//! - un gate `CONCENTRATION_LIMIT` borne le cumul par `market_id`.
//! - le circuit breaker est consomme en 3 etats : HalfOpen n'autorise qu'une
//!   sonde de taille `half_open_probe_size_usd`, jamais un trade normal.
//! - `VAR_CVAR_LIMIT` distingue `INSUFFICIENT_DATA` (historique < seuil) d'un
//!   risque mesure a zero : en demarrage, une enveloppe reduite
//!   `var_startup_envelope_usd` borne la taille — jamais de passage silencieux.
//! - `MARKET_DATA_FRESHNESS` rejette un trade construit sur un orderbook trop
//!   vieux (`max_market_data_age_ms`).

use crate::circuit_breaker::{BreakerState, CircuitBreaker, CircuitBreakerConfig};
use crate::kelly::kelly_fraction;
use crate::stress::stress_portfolio;
use crate::var::{calculate_at, VarStatus};
use crate::volatility::{VolatilityConfig, VolatilityDetector};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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

/// Parametres d'un trade candidat — l'INTENTION uniquement, jamais de limites.
///
/// `deny_unknown_fields` : tout champ inconnu (dont les anciennes limites
/// `bankroll_usd`/`max_order_usd`/`max_drawdown_usd`) est rejete a la
/// deserialisation — une strategie qui les enverrait encore est refuse
/// explicitement, jamais ignoree en silence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TradeRequest {
    pub market_id: String,
    pub side: String, // "buy" | "sell"
    pub price: f64,
    pub quantity: f64,
    pub est_value_usd: f64,
    pub win_probability: f64, // confiance du modele (0..1)
    pub odds: f64,            // cote nette (b)
    pub confidence: f64,      // confiance du modele, nb. obs. formees
    /// Age (ms) de l'orderbook qui a construit cette decision, atteste par
    /// l'appelant. Compare a `max_market_data_age_ms` (garde stale-price).
    pub market_data_age_ms: f64,
}

/// Position ouverte (ou ordre ouvert) — exposition reelle fournie par la
/// reconciliation PALLAS-M14 et transportee dans `RiskState.exposure`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExposureItem {
    pub market_id: String,
    /// Montant expose en USD (gross exposure, conservative).
    pub size_usd: f64,
    /// Evénement sous-jacent si connu (regroupe plusieurs market_ids).
    pub event_id: Option<String>,
}

impl ExposureItem {
    pub fn new(market_id: &str, size_usd: f64) -> Self {
        Self { market_id: market_id.to_string(), size_usd, event_id: None }
    }
}

/// Configuration de risque possedee par l'operateur — JAMAIS par la strategie.
/// Chargee au demarrage (fichier de config / parametrage operateur) et passee
/// au pipeline a chaque `validate_trade`. `RiskConfig::default()` est
/// conservateur (valeurs documentees) : l'absence de config ne deroule pas
/// une enveloppe infinie.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskConfig {
    pub bankroll_usd: f64,
    pub max_order_usd: f64,
    /// Exposition cumulee maximale du portefeuille (positions + ordres ouverts
    /// + nouvel ordre) — ferme la faille "20 x $500 vs limite $1000".
    pub max_portfolio_exposure_usd: f64,
    pub max_drawdown_usd: f64,
    /// Exposition maximale cumulee sur UN market_id (concentration).
    pub max_concentration_usd: f64,
    /// Taille maximale d'un trade de sonde en HalfOpen.
    pub half_open_probe_size_usd: f64,
    /// Nombre minimal d'observations P&L pour ESTIMATED.
    pub var_min_observations: usize,
    /// Enveloppe de demarrage quand l'historique est insuffisant.
    pub var_startup_envelope_usd: f64,
    /// Age maximal de l'orderbook utilise pour la decision (ms).
    pub max_market_data_age_ms: f64,
}

impl Default for RiskConfig {
    fn default() -> Self {
        Self {
            bankroll_usd: 10_000.0,
            max_order_usd: 1_000.0,
            max_portfolio_exposure_usd: 1_000.0,
            max_drawdown_usd: 5_000.0,
            max_concentration_usd: 1_000.0,
            half_open_probe_size_usd: 50.0,
            var_min_observations: 20,
            var_startup_envelope_usd: 1_000.0,
            max_market_data_age_ms: 600_000.0,
        }
    }
}

/// Etat persistant du moteur de risque.
#[derive(Default)]
pub struct RiskState {
    pub kill_switch_engaged: bool,
    pub circuit_breaker: CircuitBreaker,
    pub volatility: VolatilityDetector,
    pub hist_pnls: Vec<f64>,
    /// Exposition reelle (positions + ordres ouverts) fournie par l'appelant
    /// depuis la reconciliation PALLAS-M14.
    pub exposure: Vec<ExposureItem>,
}

impl RiskState {
    pub fn new() -> Self {
        Self {
            kill_switch_engaged: false,
            circuit_breaker: CircuitBreaker::new(CircuitBreakerConfig::default()),
            volatility: VolatilityDetector::new(VolatilityConfig::default()),
            hist_pnls: Vec::new(),
            exposure: Vec::new(),
        }
    }
}

/// Reseau de validation des bornes metier d'un `TradeRequest`. Toute valeur
/// hors bornes fait rejeter la porte `INPUT_VALIDATION` avant meme les autres
/// etapes. Les LIMITES ne sont pas validees ici : elles ne font pas partie du
/// contrat d'intention (PALLAS-M15).
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
    is_bad("confidence", !(req.confidence.is_finite() && (0.0..=1.0).contains(&req.confidence)));
    is_bad("market_data_age_ms", !(req.market_data_age_ms.is_finite() && req.market_data_age_ms >= 0.0));
    errors
}

/// Validation de la configuration operateur (source interne, mais on ne lui
/// fait pas confiance aveugle : une valeur <= 0 rend le moteur inutilisable).
fn config_validation_errors(cfg: &RiskConfig) -> Vec<String> {
    let mut errors: Vec<String> = Vec::new();
    let mut is_bad = |field: &str, cond: bool| {
        if cond {
            errors.push(field.to_string());
        }
    };
    is_bad("config.bankroll_usd", !(cfg.bankroll_usd.is_finite() && cfg.bankroll_usd > 0.0));
    is_bad("config.max_order_usd", !(cfg.max_order_usd.is_finite() && cfg.max_order_usd > 0.0));
    is_bad("config.max_portfolio_exposure_usd", !(cfg.max_portfolio_exposure_usd.is_finite() && cfg.max_portfolio_exposure_usd > 0.0));
    is_bad("config.max_drawdown_usd", !(cfg.max_drawdown_usd.is_finite() && cfg.max_drawdown_usd > 0.0));
    is_bad("config.max_concentration_usd", !(cfg.max_concentration_usd.is_finite() && cfg.max_concentration_usd > 0.0));
    is_bad("config.half_open_probe_size_usd", !(cfg.half_open_probe_size_usd.is_finite() && cfg.half_open_probe_size_usd >= 0.0));
    is_bad("config.var_min_observations", cfg.var_min_observations < 1);
    is_bad("config.var_startup_envelope_usd", !(cfg.var_startup_envelope_usd.is_finite() && cfg.var_startup_envelope_usd >= 0.0));
    is_bad("config.max_market_data_age_ms", !(cfg.max_market_data_age_ms.is_finite() && cfg.max_market_data_age_ms > 0.0));
    errors
}

/// Exposition cumulee du portefeuille (positions + ordres ouverts).
fn total_exposure(state: &RiskState) -> f64 {
    state.exposure.iter().map(|e| e.size_usd).sum()
}

/// Exposition cumulee sur un `market_id` donne (concentration).
fn market_exposure(state: &RiskState, market_id: &str) -> f64 {
    state
        .exposure
        .iter()
        .filter(|e| e.market_id == market_id)
        .map(|e| e.size_usd)
        .sum()
}

/// Tolérance de coherence `est_value_usd` ~ `price * quantity` (PALLAS-M09).
///
/// Deux sources d'ecart legitimes : (a) `est_value_usd` est arrondi au centime
/// (2 decimales) par l'appelant -> erreur absolue <= 0.01 USD ; (b) l'epsilon
/// flottant des produits refaits d'un cote et de l'autre est proportionnel aux
/// montants. Tolérance = max(0.01 USD, 1% de price*quantity) : l'absolu absorbe
/// l'arrondi centime (y compris pour les micro-trades), le relatif absorbe
/// l'epsilon des grosses valeurs. Une soumission qui declare 10x en dessous de
/// la vraie valeur (probe v0.2 : 0.9*1000=900 declaree 10, ecart 890) est
/// rejetee — 890 >> max(0.01, 9.0).
const VALUE_CONSISTENCY_TOL_ABS_USD: f64 = 0.01; // 1 centime (arrondi est_value_usd)
const VALUE_CONSISTENCY_TOL_REL: f64 = 0.01; // 1% (epsilon flottant)

/// Marge `KELLY_LIMIT` (PALLAS-M09) : 0.01 USD au-dessus du plafond recommande.
/// Le plafond est expose a l'appelant ARRONDI au centime (`suggested_size_usd`) ;
/// un appelant qui soumet exactement cette valeur `round(2)` doit passer.
/// Au-dela du centime -> rejet strict (la taille suggeree devient contraignante).
const KELLY_LIMIT_TOL_USD: f64 = 0.01;

/// Evalue un trade contre toutes les portes de securite. Retourne la decision
/// sans muter l'etat (le caller applique `apply` apres execution reelle).
///
/// Ordre : (1) kill switch, (2) validation des entrees + config, (3) les portes.
/// Les deux premieres etapes court-circuitent le pipeline (fail-closed).
pub fn validate_trade(req: &TradeRequest, state: &RiskState, config: &RiskConfig) -> TradeDecision {
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

    // 2. Validation stricte des bornes metier — avant les portes.
    let input_errors = input_validation_errors(req);
    let config_errors = config_validation_errors(config);
    if !input_errors.is_empty() || !config_errors.is_empty() {
        let mut all = input_errors;
        all.extend(config_errors);
        let reason = format!("Invalid trade input fields: {}", all.join(", "));
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
    let cb_state = state.circuit_breaker.state();

    // 3. Circuit breaker — 3 etats, pas 2 (PALLAS-M15). En HalfOpen, seul un
    //    trade de SONDE de taille <= half_open_probe_size_usd est autorise.
    let cb_action = match cb_state {
        BreakerState::Open => GateAction::Reject,
        BreakerState::HalfOpen => {
            if req.est_value_usd <= config.half_open_probe_size_usd {
                GateAction::Allow
            } else {
                GateAction::Reject
            }
        }
        BreakerState::Closed => GateAction::Allow,
    };
    gates.push(GateResult {
        gate: "CIRCUIT_BREAKER".to_string(),
        action: cb_action,
        reason: match (cb_state, cb_action) {
            (BreakerState::Open, _) => "Circuit breaker open (state: Open): all trades rejected".to_string(),
            (BreakerState::HalfOpen, GateAction::Allow) => format!(
                "Circuit breaker half-open: probe allowed (order ${:.2} <= probe ${:.2})",
                req.est_value_usd, config.half_open_probe_size_usd
            ),
            (BreakerState::HalfOpen, GateAction::Reject) => format!(
                "Circuit breaker half-open: probe ONLY (order ${:.2} > probe ${:.2})",
                req.est_value_usd, config.half_open_probe_size_usd
            ),
            (BreakerState::Closed, _) => "Circuit breaker closed".to_string(),
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

    // 5. Coherence valeur metier : est_value_usd ~ price * quantity.
    //    Comparer ces champs LIES (et chacun contre sa borne) ferme la faille
    //    d'une valeur declaree sous le plafond alors que l'ordre coute plus.
    let expected_value = req.price * req.quantity;
    let value_tol = VALUE_CONSISTENCY_TOL_ABS_USD.max(expected_value.abs() * VALUE_CONSISTENCY_TOL_REL);
    let value_consistent = (req.est_value_usd - expected_value).abs() <= value_tol;
    gates.push(GateResult {
        gate: "VALUE_CONSISTENCY".to_string(),
        action: if value_consistent { GateAction::Allow } else { GateAction::Reject },
        reason: if value_consistent {
            format!("est_value_usd ${:.2} ~= price*quantity ${:.2}", req.est_value_usd, expected_value)
        } else {
            format!(
                "est_value_usd ${:.2} incoherent avec price*quantity ${:.2} (hors tolérance ${:.2})",
                req.est_value_usd, expected_value, value_tol
            )
        },
    });

    // 6. Position max — EXPOSITION cumulee (PALLAS-M15). Deux conditions :
    //    (a) l'ordre isole <= max_order_usd ; (b) exposition du portefeuille
    //    APRES execution (positions + ordres ouverts + nouvel ordre)
    //    <= max_portfolio_exposure_usd. 20 x $500 face a une limite de $1000
    //    sont desormais rejetes des que le cumul depasse la limite.
    let order_size_ok = req.est_value_usd <= config.max_order_usd;
    let exposure_after = total_exposure(state) + req.est_value_usd;
    let portfolio_ok = exposure_after <= config.max_portfolio_exposure_usd;
    let within_position = order_size_ok && portfolio_ok;
    gates.push(GateResult {
        gate: "POSITION_LIMIT".to_string(),
        action: if within_position { GateAction::Allow } else { GateAction::Reject },
        reason: if order_size_ok && portfolio_ok {
            format!(
                "Order ${:.2} <= max ${:.2}; portfolio exposure after ${:.2} <= limit ${:.2}",
                req.est_value_usd, config.max_order_usd, exposure_after, config.max_portfolio_exposure_usd
            )
        } else if !order_size_ok {
            format!(
                "Order size ${:.2} exceeds max order ${:.2}",
                req.est_value_usd, config.max_order_usd
            )
        } else {
            format!(
                "Portfolio exposure after execution ${:.2} exceeds limit ${:.2} (cumulative)",
                exposure_after, config.max_portfolio_exposure_usd
            )
        },
    });

    // 7. Concentration par marche (PALLAS-M15) : l'exposition cumulee sur un
    //    seul `market_id` (positions + ordres ouverts + nouvel ordre) ne
    //    depasse pas max_concentration_usd. Le regroupement par événement sous-
    //    jacent est possible si `event_id` est renseigne sur les items d'exposition
    //    (le trade ne porte pas lui-meme un event_id — limite documentee).
    let market_exposure_after = market_exposure(state, &req.market_id) + req.est_value_usd;
    let within_concentration = market_exposure_after <= config.max_concentration_usd;
    gates.push(GateResult {
        gate: "CONCENTRATION_LIMIT".to_string(),
        action: if within_concentration { GateAction::Allow } else { GateAction::Reject },
        reason: if within_concentration {
            format!(
                "Market {} exposure after ${:.2} <= concentration limit ${:.2}",
                req.market_id, market_exposure_after, config.max_concentration_usd
            )
        } else {
            format!(
                "Market {} exposure after ${:.2} exceeds concentration limit ${:.2}",
                req.market_id, market_exposure_after, config.max_concentration_usd
            )
        },
    });

    // 8. Prix hors marche (absurde).
    let sane_price = req.price > 0.0 && req.price <= 1.0; // marche binaire (0..1)
    gates.push(GateResult {
        gate: "PRICE_SANITY".to_string(),
        action: if sane_price { GateAction::Allow } else { GateAction::Reject },
        reason: format!("Price {} valid", req.price),
    });

    // 9. Quantite positive.
    let positive_qty = req.quantity > 0.0;
    gates.push(GateResult {
        gate: "QUANTITY_POSITIVE".to_string(),
        action: if positive_qty { GateAction::Allow } else { GateAction::Reject },
        reason: format!("Quantity {} {}", req.quantity, if positive_qty { "positive" } else { "<= 0" }),
    });

    // 10. Kelly : la taille demandee ne depasse pas la taille suggeree FINALE
    //     (kelly fractionnaire x multiplicateur de regime de volatilite,
    //     plafonnee a max_order_usd). La bankroll vient de LA CONFIGURATION
    //     (PALLAS-M15) : la strategie ne peut pas elargir son enveloppe.
    let kelly = kelly_fraction(req.win_probability, req.odds, config.bankroll_usd, 0.5);
    let kelly_bound = (kelly.recommended_size * vol.size_multiplier).min(config.max_order_usd);
    let kelly_ok = req.est_value_usd <= kelly_bound + KELLY_LIMIT_TOL_USD;
    gates.push(GateResult {
        gate: "KELLY_LIMIT".to_string(),
        action: if kelly_ok { GateAction::Allow } else { GateAction::Reject },
        reason: if kelly_ok {
            format!("Order ${:.2} <= kelly suggested ${:.2}", req.est_value_usd, kelly_bound)
        } else {
            format!(
                "Order ${:.2} exceeds kelly suggested ${:.2}",
                req.est_value_usd, kelly_bound
            )
        },
    });

    // 11. VaR/CVaR avec etat de confiance explicite (PALLAS-M15, F-08).
    //     Historique < var_min_observations => INSUFFICIENT_DATA : l'absence de
    //     donnees n'est JAMAIS un risque nul. Politique explicite : petite
    //     enveloppe de demarrage var_startup_envelope_usd (rejet au-dela).
    let var = calculate_at(&state.hist_pnls, 0.95);
    let var_insufficient = var.sample_size < config.var_min_observations;
    let var_ok = if var_insufficient {
        req.est_value_usd <= config.var_startup_envelope_usd
    } else {
        var.cvar <= config.max_drawdown_usd * 0.5
    };
    gates.push(GateResult {
        gate: "VAR_CVAR_LIMIT".to_string(),
        action: if var_ok { GateAction::Allow } else { GateAction::Reject },
        reason: if var_insufficient {
            format!(
                "INSUFFICIENT_DATA ({} obs < {}) — {} startup envelope ${:.2}",
                var.sample_size,
                config.var_min_observations,
                if var_ok { "ordre dans" } else { "ordre hors" },
                config.var_startup_envelope_usd
            )
        } else {
            format!(
                "CVaR ${:.2} [{}] {} limit ${:.2}",
                var.cvar,
                match var.status {
                    VarStatus::Estimated => "ESTIMATED".to_string(),
                    VarStatus::InsufficientData => "INSUFFICIENT_DATA".to_string(),
                },
                if var_ok { "within" } else { "exceeds" },
                config.max_drawdown_usd * 0.5
            )
        },
    });

    // 12. Stress test — la perte max tolerable ne blesse pas la bankroll
    //     (bankroll et drawdown depuis la configuration, PALLAS-M15).
    let stress = stress_portfolio(config.bankroll_usd, config.max_drawdown_usd);
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

    // 13. Confiance minimale.
    let confidence_ok = req.confidence >= 0.5;
    gates.push(GateResult {
        gate: "MIN_CONFIDENCE".to_string(),
        action: if confidence_ok { GateAction::Allow } else { GateAction::Reject },
        reason: format!("Model confidence {:.2}", req.confidence),
    });

    // 14. Fraicheur des donnees de marche (stale-price, PALLAS-M15). Le trade
    //     est rejete si l'orderbook qui l'a construit est trop vieux.
    let data_fresh = req.market_data_age_ms <= config.max_market_data_age_ms;
    gates.push(GateResult {
        gate: "MARKET_DATA_FRESHNESS".to_string(),
        action: if data_fresh { GateAction::Allow } else { GateAction::Reject },
        reason: format!(
            "Market data age {}ms {} cap {}ms",
            req.market_data_age_ms,
            if data_fresh { "within" } else { "exceeds" },
            config.max_market_data_age_ms
        ),
    });

    let rejected: Vec<String> = gates
        .iter()
        .filter(|g| g.action == GateAction::Reject)
        .map(|g| g.gate.clone())
        .collect();

    let allowed = rejected.is_empty();
    let mut suggested_size = if allowed && kelly.positive_ev {
        (kelly.recommended_size * vol.size_multiplier).min(config.max_order_usd)
    } else {
        0.0
    };
    if cb_state == BreakerState::HalfOpen {
        suggested_size = suggested_size.min(config.half_open_probe_size_usd);
    }

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
            est_value_usd: 6.0, // coherent : price * quantity = 6 (M09)
            win_probability: 0.7,
            odds: 0.7,
            confidence: 0.8,
            market_data_age_ms: 0.0, // donnees fraiches
        }
    }

    /// Configuration nominale des tests pre-M15 (limites historicables).
    fn test_config() -> RiskConfig {
        RiskConfig {
            bankroll_usd: 10_000.0,
            max_order_usd: 1_000.0,
            max_portfolio_exposure_usd: 1_000.0,
            max_drawdown_usd: 5_000.0,
            max_concentration_usd: 1_000.0,
            half_open_probe_size_usd: 50.0,
            var_min_observations: 2,
            var_startup_envelope_usd: 1_000.0,
            max_market_data_age_ms: 600_000.0,
        }
    }

    #[test]
    fn full_pipeline_approves_valid_trade() {
        let mut state = RiskState::new();
        state.hist_pnls.push(1.0);
        state.hist_pnls.push(-1.0);
        state.hist_pnls.push(2.0);
        state.hist_pnls.push(-2.0);
        let d = validate_trade(&valid_req(), &state, &test_config());
        assert!(d.allowed, "rejected by {:?}", d.rejected_by);
    }

    #[test]
    fn kill_switch_blocks_all_trades() {
        // note : le kill switch est modelise en amont (gate de dry-run).
        // On verifie que chaque porte rejette independamment.
        let mut req = valid_req();
        req.est_value_usd = 99_999.0;
        let config = RiskConfig { max_order_usd: 1.0, ..test_config() };
        let state = RiskState::new();
        let d = validate_trade(&req, &state, &config);
        assert!(!d.allowed);
        assert!(d.rejected_by.contains(&"POSITION_LIMIT".to_string()));
    }

    #[test]
    fn oversized_order_rejected() {
        let mut req = valid_req();
        req.est_value_usd = 5_000.0;
        let state = RiskState::new();
        let d = validate_trade(&req, &state, &test_config());
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
        let d = validate_trade(&valid_req(), &state, &test_config());
        assert!(d.rejected_by.contains(&"CIRCUIT_BREAKER".to_string()));
        assert!(!d.allowed);
    }

    #[test]
    fn pipeline_is_deterministic() {
        let state = RiskState::new();
        let a = validate_trade(&valid_req(), &state, &test_config());
        let b = validate_trade(&valid_req(), &state, &test_config());
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
            confidence: 0.8,
            market_data_age_ms: 0.0,
        };
        let state = RiskState::new();
        let d = validate_trade(&req, &state, &test_config());
        assert!(!d.allowed);
        assert!(d.rejected_by.contains(&"INPUT_VALIDATION".to_string()));
        assert_eq!(d.suggested_size_usd, 0.0);
        assert_eq!(d.gates.len(), 1, "short-circuit: seule la porte INPUT_VALIDATION");
    }

    #[test]
    fn kill_switch_engaged_blocks_every_trade() {
        let mut state = RiskState::new();
        state.kill_switch_engaged = true;
        let d = validate_trade(&valid_req(), &state, &test_config());
        assert!(!d.allowed);
        assert!(d.rejected_by.contains(&"KILL_SWITCH".to_string()));
        assert_eq!(d.gates.len(), 1, "short-circuit: seule la porte KILL_SWITCH");
        // meme un trade autrement valide est bloque.
        let mut req = valid_req();
        req.side = "garbage".to_string();
        let d2 = validate_trade(&req, &state, &test_config());
        assert!(d2.rejected_by.contains(&"KILL_SWITCH".to_string()));
        assert!(!d2.rejected_by.contains(&"INPUT_VALIDATION".to_string()));
    }

    #[test]
    fn input_validation_rejects_each_bound() {
        type TradeBoundMutator = Box<dyn Fn(&mut TradeRequest)>;
        let cases: Vec<(&'static str, TradeBoundMutator)> = vec![
            ("market_id", Box::new(|r| r.market_id = String::new())),
            ("side", Box::new(|r| r.side = "SELL".to_string())),
            ("price", Box::new(|r| r.price = 1.5)),
            ("quantity", Box::new(|r| r.quantity = 0.0)),
            ("est_value_usd", Box::new(|r| r.est_value_usd = -1.0)),
            ("win_probability", Box::new(|r| r.win_probability = 1.5)),
            ("confidence", Box::new(|r| r.confidence = -0.5)),
            ("market_data_age_ms", Box::new(|r| r.market_data_age_ms = -1.0)),
        ];
        for (field, mutate) in cases {
            let mut req = valid_req();
            mutate(&mut req);
            let state = RiskState::new();
            let d = validate_trade(&req, &state, &test_config());
            assert!(!d.allowed, "field {field} devrait etre rejete");
            assert!(
                d.rejected_by.contains(&"INPUT_VALIDATION".to_string()),
                "field {field}: rejected_by = {:?}",
                d.rejected_by
            );
        }
    }

    // --- PALLAS-M15 : la configuration est la seule source des limites ---
    // P0-03 (v0.2.1) : la strategie ne peut pas elargir sa propre enveloppe.

    #[test]
    fn limits_come_from_config_not_trade_ipso_facto() {
        // Meme TradeRequest d'intention valide contre DEUX configurations : seul
        // le RiskConfig change le verdict POSITION_LIMIT. C'est le test P0-03 :
        // le payload du trade ne porte plus bankroll_usd/max_order_usd/
        // max_drawdown_usd (champs supprimes du contrat) — la preuve "the
        // strategy cannot vary limits" est en premier lieu structurelle.
        let cfg_tight = RiskConfig { max_order_usd: 10.0, max_portfolio_exposure_usd: 10.0, ..test_config() };
        let cfg_loose = RiskConfig { max_order_usd: 1_000.0, max_portfolio_exposure_usd: 1_000.0, ..test_config() };
        let mut req = valid_req();
        req.est_value_usd = 30.0; // 30 > max_order 10 (tight), <= 1000 (loose)
        req.quantity = req.est_value_usd / req.price;
        let state = RiskState::new();
        let tight = validate_trade(&req, &state, &cfg_tight);
        let loose = validate_trade(&req, &state, &cfg_loose);
        assert!(tight.rejected_by.contains(&"POSITION_LIMIT".to_string()));
        assert!(loose.allowed);
    }

    #[test]
    fn stale_market_data_rejected() {
        let req = TradeRequest { market_data_age_ms: 900_000.0, ..valid_req() };
        let state = RiskState::new();
        let d = validate_trade(&req, &state, &test_config());
        assert!(
            d.rejected_by.contains(&"MARKET_DATA_FRESHNESS".to_string()),
            "rejected_by = {:?}",
            d.rejected_by
        );
    }

    // --- PALLAS-M15 : exposition reelle cumulee (F-04 / P0-02) ---
    // 20 ordres de $500 avec une limite de portefeuille de $1000 : rejet
    // des que l'exposition apres execution depasse la limite.

    #[test]
    fn cumulative_portfolio_exposure_stops_20x500_order_stream() {
        let config = RiskConfig {
            max_order_usd: 500.0,
            max_portfolio_exposure_usd: 1_000.0,
            max_concentration_usd: 100_000.0, // isole la porte portefeuille
            ..test_config()
        };
        let mut state = RiskState::new();
        state.hist_pnls.extend(vec![1.0, -1.0, 2.0]); // ESTIMATED (>= 2 obs)
        let mut allowed_count = 0usize;
        for i in 0..20 {
            let mut req = valid_req();
            req.market_id = format!("m{}", i); // marches DIFFERENTS : porte concentration isolee
            req.est_value_usd = 500.0;
            req.quantity = req.est_value_usd / req.price;
            let d = validate_trade(&req, &state, &config);
            if d.allowed {
                allowed_count += 1;
                // chaque ordre accepte devient une exposition reelle a l'echange.
                state.exposure.push(ExposureItem::new(&req.market_id, req.est_value_usd));
            }
        }
        // ordre 1 (500) et 2 (500 -> cumul 1000) passent ; le 3e (cumul 1500) est refuse.
        assert_eq!(allowed_count, 2);
        // la limite est stricte : jamais 20 x 500.
    }

    #[test]
    fn concentration_limit_blocks_second_order_on_same_market() {
        let config = RiskConfig {
            max_order_usd: 500.0,
            max_portfolio_exposure_usd: 100_000.0, // isole la porte concentration
            max_concentration_usd: 800.0,
            ..test_config()
        };
        let mut state = RiskState::new();
        state.hist_pnls.extend(vec![1.0, -1.0, 2.0]);
        let mut req = valid_req();
        req.est_value_usd = 500.0;
        req.quantity = req.est_value_usd / req.price;
        let first = validate_trade(&req, &state, &config);
        assert!(first.allowed, "premier ordre sur m1: {:?}", first.rejected_by);
        state.exposure.push(ExposureItem::new("m1", 500.0));
        let second = validate_trade(&req, &state, &config);
        assert!(
            second.rejected_by.contains(&"CONCENTRATION_LIMIT".to_string()),
            "second ordre sur m1 doit bloquer la concentration: {:?}",
            second.rejected_by
        );
    }

    // --- PALLAS-M15 : HalfOpen restrictif (F-04 / v0.2.1 P1-04) ---

    #[test]
    fn half_open_allows_probe_but_rejects_normal_trade() {
        let config = test_config(); // probe 50, normal cap 1000
        let mut state = RiskState::new();
        state.circuit_breaker = CircuitBreaker::new(CircuitBreakerConfig {
            max_consecutive_losses: 1,
            recovery_observations: 1,
            ..Default::default()
        });
        state.circuit_breaker.record_pnl(-1.0); // Open
        state.circuit_breaker.record_pnl(0.0); // 1 obs -> HalfOpen
        assert_eq!(state.circuit_breaker.state(), BreakerState::HalfOpen);

        let normal = TradeRequest { est_value_usd: 500.0, quantity: 500.0 / 0.6, ..valid_req() };
        let d_normal = validate_trade(&normal, &state, &config);
        assert!(
            d_normal.rejected_by.contains(&"CIRCUIT_BREAKER".to_string()),
            "trade normal en HalfOpen doit etre rejete: {:?}",
            d_normal.rejected_by
        );

        let probe = TradeRequest { est_value_usd: 30.0, quantity: 30.0 / 0.6, ..valid_req() };
        let d_probe = validate_trade(&probe, &state, &config);
        assert!(
            d_probe.allowed,
            "sonde <= probe size doit passer en HalfOpen: {:?}",
            d_probe.rejected_by
        );
        assert!(d_probe.suggested_size_usd <= config.half_open_probe_size_usd);
    }

    // --- PALLAS-M15 : VaR/CVaR INSUFFICIENT_DATA vs risque mesure (F-08) ---

    #[test]
    fn var_gate_reflects_insufficient_data_at_zero_and_one_observation() {
        let config = test_config(); // var_min_observations = 2, enveloppe demarrage 1000
        let req = valid_req();

        // 0 observation : INSUFFICIENT_DATA. Trade DANS l'enveloppe -> allow,
        // mais le motif le dit explicitement (jamais "risque nul silencieux").
        let state = RiskState::new();
        let d0 = validate_trade(&req, &state, &config);
        let gate0 = d0.gates.iter().find(|g| g.gate == "VAR_CVAR_LIMIT").unwrap();
        assert!(d0.allowed, "enveloppe de demarrage doit autoriser: {:?}", d0.rejected_by);
        assert!(gate0.reason.contains("INSUFFICIENT_DATA"));

        // 1 observation : idem.
        let mut state1 = RiskState::new();
        state1.hist_pnls.push(-100.0);
        let d1 = validate_trade(&req, &state1, &config);
        let gate1 = d1.gates.iter().find(|g| g.gate == "VAR_CVAR_LIMIT").unwrap();
        assert!(gate1.reason.contains("INSUFFICIENT_DATA"));

        // Trade HORS enveloppe -> rejet explicite VAR_CVAR_LIMIT (pas de passage).
        let big_req = TradeRequest { est_value_usd: 5_000.0, quantity: 5_000.0 / 0.6, ..valid_req() };
        let d_big = validate_trade(&big_req, &state, &config);
        assert!(
            d_big.rejected_by.contains(&"VAR_CVAR_LIMIT".to_string()),
            "hors enveloppe de demarrage: {:?}",
            d_big.rejected_by
        );
    }

    // --- PALLAS-M15 : une config invalide est refuse (fail-closed) ---

    #[test]
    fn invalid_config_is_rejected() {
        let config = RiskConfig { max_order_usd: 0.0, ..test_config() };
        let state = RiskState::new();
        let d = validate_trade(&valid_req(), &state, &config);
        assert!(
            d.rejected_by.contains(&"INPUT_VALIDATION".to_string()),
            "config invalide doit court-circuiter: {:?}",
            d.rejected_by
        );
    }

    // --- PALLAS-M09 : coherence metier (audit v0.2 §4.1) ---
    // Les 2 tests adversariaux portent le nom `audit_v0_2_rejects_*` pour la
    // tracabilite. Ils ont ete ecrits AVANT la correction (baseline : ils
    // echouent sur le code pre-M09, preuve reproduite — voir journal M09).

    #[test]
    fn audit_v0_2_rejects_incoherent_est_value_usd() {
        // Probe : price=0.9 * quantity=1000 -> vraie valeur 900, mais
        // est_value_usd=10 declaree pour passer sous le plafond POSITION_LIMIT.
        let mut req = valid_req();
        req.price = 0.9;
        req.quantity = 1000.0;
        req.est_value_usd = 10.0; // incoherent : 0.9*1000 = 900
        let state = RiskState::new();
        let d = validate_trade(&req, &state, &test_config());
        assert!(
            !d.allowed,
            "est_value_usd incoherent doit etre rejete (rejected_by={:?})",
            d.rejected_by
        );
        assert!(d.rejected_by.contains(&"VALUE_CONSISTENCY".to_string()));
    }

    #[test]
    fn audit_v0_2_rejects_est_above_kelly_recommended() {
        // Probe : est_value_usd (4000) depasse la taille suggeree finale
        // (kelly half ~1357 * mult 1.0, plafond max_order 5000) mais reste sous
        // bankroll (10000) -> KELLY_LIMIT doit rejeter. La bankroll et le plafond
        // viennent de la configuration (PALLAS-M15). Config dediee : ni
        // POSITION_LIMIT ni CONCENTRATION ne doivent etre la cause — Kelly seul.
        let mut req = valid_req();
        req.win_probability = 0.7;
        req.odds = 0.7;
        req.price = 0.6;
        req.quantity = 6666.666666666667; // 0.6 * qty = 4000.0 (coherent)
        req.est_value_usd = 4_000.0;
        let cfg = RiskConfig {
            bankroll_usd: 10_000.0,
            max_order_usd: 5_000.0,
            max_portfolio_exposure_usd: 5_000.0,
            max_concentration_usd: 5_000.0,
            ..test_config()
        };
        let state = RiskState::new();
        let d = validate_trade(&req, &state, &cfg);
        assert!(
            !d.allowed,
            "taille > kelly suggere doit etre rejetee (rejected_by={:?})",
            d.rejected_by
        );
        assert!(
            d.rejected_by.contains(&"KELLY_LIMIT".to_string()),
            "rejected_by = {:?}",
            d.rejected_by
        );
        assert!(!d.rejected_by.contains(&"POSITION_LIMIT".to_string()));
    }

    // Limites de tolerance — depassant, ces cas LEGITIMES restent acceptes.

    #[test]
    fn kelly_accepts_trade_at_suggested_size() {
        // est_value_usd == suggested_size_usd (arrondi centime) doit passer :
        // recommended ~1357 plafonne a max_order 1000 -> suggere 1000.0.
        let mut req = valid_req();
        req.price = 0.6;
        req.quantity = 1666.6666666666667; // 0.6 * qty = 1000.0
        req.est_value_usd = 1_000.0;
        let state = RiskState::new();
        let d = validate_trade(&req, &state, &test_config());
        assert!(d.allowed, "taille = suggested doit passer, rejected_by={:?}", d.rejected_by);
    }

    #[test]
    fn value_consistency_accepts_cent_rounding_micro_trade() {
        // Micro trade : price 0.006 * qty 2 = 0.012, est arrondi au centime 0.01.
        // La tolérance absolue de 1 centime (pas un pur 1% relatif) absorbe
        // l'arrondi des petits montants.
        let mut req = valid_req();
        req.price = 0.006;
        req.quantity = 2.0;
        req.est_value_usd = 0.01;
        let state = RiskState::new();
        let d = validate_trade(&req, &state, &test_config());
        assert!(d.allowed, "rounded micro-trade doit passer, rejected_by={:?}", d.rejected_by);
    }
}
