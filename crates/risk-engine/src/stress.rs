//! Stress test — 5 scenarios de marche adverse.
//!
//! Applique des chocs au P&L cumule pour valider que la position resiste.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StressScenario {
    /// -5% en une journee.
    Crash5Pct,
    /// -10% en une journee.
    Crash10Pct,
    /// Flash crash : -15% en quelques minutes.
    FlashCrash,
    /// Gap de marché (saut de prix).
    GapDown,
    /// Evénement extrême : -25%.
    BlackSwan,
}

impl StressScenario {
    /// Choc negatif en fraction (0..1).
    pub fn shock(&self) -> f64 {
        match self {
            StressScenario::Crash5Pct => 0.05,
            StressScenario::Crash10Pct => 0.10,
            StressScenario::FlashCrash => 0.15,
            StressScenario::GapDown => 0.12,
            StressScenario::BlackSwan => 0.25,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            StressScenario::Crash5Pct => "crash_5pct",
            StressScenario::Crash10Pct => "crash_10pct",
            StressScenario::FlashCrash => "flash_crash",
            StressScenario::GapDown => "gap_down",
            StressScenario::BlackSwan => "black_swan",
        }
    }

    pub fn all() -> Vec<StressScenario> {
        vec![
            StressScenario::Crash5Pct,
            StressScenario::Crash10Pct,
            StressScenario::FlashCrash,
            StressScenario::GapDown,
            StressScenario::BlackSwan,
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StressOutcome {
    pub scenario: String,
    pub estimated_loss: f64,
    pub survices: bool,
    pub max_allowable_loss: f64,
}

/// Evalue la survie sous choc. `portfolio_value` etant la valeur du portefeuille
/// et `max_allowable_loss` la perte maximale tolerable.
pub fn stress_portfolio(
    portfolio_value: f64,
    max_allowable_loss: f64,
) -> Vec<StressOutcome> {
    StressScenario::all()
        .into_iter()
        .map(|s| {
            let loss = portfolio_value * s.shock();
            StressOutcome {
                scenario: s.name().to_string(),
                estimated_loss: (loss * 100.0).round() / 100.0,
                survices: loss <= max_allowable_loss,
                max_allowable_loss,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn black_swan_is_worst() {
        let worst = StressScenario::all()
            .into_iter()
            .max_by(|a, b| a.shock().total_cmp(&b.shock()))
            .unwrap();
        assert_eq!(worst, StressScenario::BlackSwan);
    }

    #[test]
    fn survives_small_shock() {
        let outcomes = stress_portfolio(100_000.0, 30_000.0);
        let crash5 = outcomes
            .iter()
            .find(|o| o.scenario == "crash_5pct")
            .unwrap();
        assert!(crash5.survices);
    }

    #[test]
    fn dies_on_black_swan_with_tight_limits() {
        let outcomes = stress_portfolio(100_000.0, 10_000.0);
        let bs = outcomes
            .iter()
            .find(|o| o.scenario == "black_swan")
            .unwrap();
        assert!(!bs.survices);
        assert!((bs.estimated_loss - 25_000.0).abs() < 1.0);
    }
}
