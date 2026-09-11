//! Detection de regime de volatilite.
//!
//! Regimes : low / normal / high / extreme.
//! Calibrage adaptatif : baseline calculee sur la premiere fenetre complete,
//! puis classification relative a cette baseline. En regime extreme, trading
//! arrete ; en regime haut, taille reduite.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Regime {
    Low,
    Normal,
    High,
    Extreme,
}

/// Etat dynamique du detecteur (fenetre + baseline), serialisable pour le
/// contrat CLI. La config (tailles de fenetre, seuils) reste par defaut.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VolatilityState {
    pub window: Vec<f64>,
    pub baseline: Option<f64>,
}

impl Regime {
    pub fn as_str(&self) -> &'static str {
        match self {
            Regime::Low => "low",
            Regime::Normal => "normal",
            Regime::High => "high",
            Regime::Extreme => "extreme",
        }
    }
}

pub struct VolatilityConfig {
    /// Nombre d'observations pour la baseline.
    pub baseline_window: usize,
    /// Multiplieur de stock-sd par rapport a la baseline pour passer high.
    pub high_mult: f64,
    /// Multiplieur pour extreme.
    pub extreme_mult: f64,
    /// Arreter le trading en regime extreme ?
    pub halt_on_extreme: bool,
}

impl Default for VolatilityConfig {
    fn default() -> Self {
        Self {
            baseline_window: 30,
            high_mult: 2.0,
            extreme_mult: 4.0,
            halt_on_extreme: true,
        }
    }
}

pub struct VolatilitySnapshot {
    pub regime: Regime,
    pub size_multiplier: f64,
    pub rolling_std_dev: f64,
    pub should_halt: bool,
}

impl Default for VolatilityDetector {
    fn default() -> Self {
        Self::new(VolatilityConfig::default())
    }
}

pub struct VolatilityDetector {
    baseline_window: usize,
    high_mult: f64,
    extreme_mult: f64,
    halt_on_extreme: bool,
    window: Vec<f64>,
    baseline: Option<f64>,
}

impl VolatilityDetector {
    pub fn new(config: VolatilityConfig) -> Self {
        Self {
            baseline_window: config.baseline_window,
            high_mult: config.high_mult,
            extreme_mult: config.extreme_mult,
            halt_on_extreme: config.halt_on_extreme,
            window: Vec::new(),
            baseline: None,
        }
    }

    pub fn add(&mut self, pnl_pct: f64) {
        self.window.push(pnl_pct);
        // calibre la baseline une fois assez d'observations
        if self.baseline.is_none() && self.window.len() >= self.baseline_window {
            let arr = &self.window[..self.baseline_window];
            let mean = arr.iter().sum::<f64>() / arr.len() as f64;
            let variance = arr.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / arr.len() as f64;
            self.baseline = Some(variance.sqrt());
        }
    }

    pub fn detect(&self) -> VolatilitySnapshot {
        if self.baseline.is_none() || self.window.len() < 2 {
            return VolatilitySnapshot {
                regime: Regime::Normal,
                size_multiplier: 1.0,
                rolling_std_dev: 0.0,
                should_halt: false,
            };
        }
        let arr = &self.window;
        let mean = arr.iter().sum::<f64>() / arr.len() as f64;
        let variance = arr.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / arr.len() as f64;
        let sd = variance.sqrt();
        let base = self.baseline.unwrap_or(0.0);

        let regime = if base <= 1e-12 {
            Regime::Normal
        } else {
            let ratio = sd / base;
            if ratio >= self.extreme_mult {
                Regime::Extreme
            } else if ratio >= self.high_mult {
                Regime::High
            } else {
                Regime::Normal
            }
        };

        let size_multiplier = match regime {
            Regime::Low => 1.2,
            Regime::Normal => 1.0,
            Regime::High => 0.5,
            Regime::Extreme => 0.25,
        };
        let should_halt = regime == Regime::Extreme && self.halt_on_extreme;

        VolatilitySnapshot {
            regime,
            size_multiplier,
            rolling_std_dev: sd,
            should_halt,
        }
    }

    /// Snapshot serialisable pour le contrat CLI (transport entre appels).
    pub fn snapshot(&self) -> VolatilityState {
        VolatilityState {
            window: self.window.clone(),
            baseline: self.baseline,
        }
    }

    /// Restaure l'etat depuis un snapshot recu (persistance par l'appelant).
    pub fn restore(&mut self, snap: &VolatilityState) {
        self.window = snap.window.clone();
        self.baseline = snap.baseline;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_state_normal() {
        let d = VolatilityDetector::new(VolatilityConfig::default());
        let s = d.detect();
        assert_eq!(s.regime, Regime::Normal);
        assert_eq!(s.size_multiplier, 1.0);
        assert!(!s.should_halt);
    }

    #[test]
    fn low_volatility_increases_size() {
        let mut d = VolatilityDetector::new(VolatilityConfig::default());
        // fenetre basse volatilite (constant)
        for _ in 0..31 {
            d.add(0.01);
        }
        let s = d.detect();
        assert_eq!(s.regime, Regime::Normal); // ratio ~ 0 => normal (base ~0)
        assert_eq!(s.size_multiplier, 1.0);
    }

    #[test]
    fn high_volatility_reduces_size() {
        let mut d = VolatilityDetector::new(VolatilityConfig::default());
        // baseline avec petite variance non nulle (~0.005)
        for i in 0..30 {
            d.add(if i % 2 == 0 { 0.005 } else { -0.005 });
        }
        // puis forte volatilite (~0.15)
        for _ in 0..10 {
            d.add(0.15);
            d.add(-0.15);
        }
        let s = d.detect();
        assert!(
            s.regime == Regime::High || s.regime == Regime::Extreme,
            "regime = {:?} (sd={})",
            s.regime,
            s.rolling_std_dev
        );
    }

    #[test]
    fn halts_on_extreme_volatility() {
        let mut d = VolatilityDetector::new(VolatilityConfig::default());
        // baseline avec petite variance
        for i in 0..30 {
            d.add(if i % 2 == 0 { 0.005 } else { -0.005 });
        }
        // chocs tres violents
        for _ in 0..20 {
            d.add(0.5);
            d.add(-0.5);
        }
        let s = d.detect();
        assert!(s.should_halt, "regime = {:?}", s.regime);
        assert_eq!(s.regime, Regime::Extreme);
    }

    #[test]
    fn snapshot_roundtrip_preserves_state() {
        let mut d = VolatilityDetector::new(VolatilityConfig::default());
        for i in 0..30 {
            d.add(if i % 2 == 0 { 0.005 } else { -0.005 });
        }
        let snap = d.snapshot();
        assert!(snap.baseline.is_some());

        let mut restored = VolatilityDetector::default();
        restored.restore(&snap);
        assert_eq!(restored.snapshot(), snap);
        let s = restored.detect();
        assert_eq!(s.regime, Regime::Normal);
    }
}
