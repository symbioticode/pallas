//! Value-at-Risk (VaR) et Conditional VaR (Expected Shortfall).
//!
//! - Historical VaR : percentile des pertes sur fenetre glissante
//! - Parametric VaR : hypothese normale (inverse CDF approx. Beasley-Springer-Moro)
//! - CVaR / Expected Shortfall : moyenne des pertes au-dela du seuil VaR

use serde::{Deserialize, Serialize};

/// Invariant global : les valeurs de risque ne sont jamais negatives.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaRResult {
    pub historical_var: f64,
    pub parametric_var: f64,
    pub cvar: f64,
    pub confidence_level: f64,
    pub sample_size: usize,
    pub mean_pnl: f64,
    pub std_dev: f64,
}

/// VaR historique sur un tableau [P&L] donne, au niveau de confiance donne.
pub fn var_historical(pnls: &[f64], confidence: f64) -> f64 {
    if pnls.len() < 2 {
        return 0.0;
    }
    let mut sorted = pnls.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let idx = ((1.0 - confidence) * sorted.len() as f64).floor() as usize;
    let idx = idx.max(0).min(sorted.len() - 1);
    let loss = sorted[idx];
    if loss >= 0.0 {
        0.0
    } else {
        -loss
    }
}

/// CVaR (Expected Shortfall) sur un tableau [P&L].
pub fn cvar(pnls: &[f64], confidence: f64) -> f64 {
    if pnls.len() < 2 {
        return 0.0;
    }
    let mut sorted = pnls.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let tail_count = ((1.0 - confidence) * sorted.len() as f64).floor() as usize + 1;
    let tail_count = tail_count.max(1).min(sorted.len());
    let sum: f64 = sorted[..tail_count].iter().sum();
    let avg = sum / tail_count as f64;
    if avg >= 0.0 {
        0.0
    } else {
        -avg
    }
}

/// Inverse CDF de la normale — approximation de Beasley-Springer-Moro.
fn norm_inv(p: f64) -> f64 {
    let a = [
        -3.969683028665376e1,
        2.209460984245205e2,
        -2.759285104469687e2,
        1.383577518672690e2,
        -3.066479806614716e1,
        2.506628277459239e0,
    ];
    let b = [
        -5.447609879822406e1,
        1.615858368580409e2,
        -1.556989798598866e2,
        6.680131188771972e1,
        -1.328068155288572e1,
    ];
    let c = [
        -7.784894002430293e-3,
        -3.223964580411365e-1,
        -2.400758277161838e0,
        -2.549732539343734e0,
        4.374664141464968e0,
        2.938163982698783e0,
    ];
    let d = [
        7.784695709041462e-3,
        3.224671290700398e-1,
        2.445134137142996e0,
        3.754408661907416e0,
    ];

    let p_low = 0.02425;
    let p_high = 1.0 - p_low;

    if p < p_low {
        let q = (-2.0 * p.ln()).sqrt();
        let num = horner(&c, q);
        let den = horner(&d, q) + 1.0;
        return num / den;
    } else if p <= p_high {
        let q = p - 0.5;
        let r = q * q;
        let num = q * horner(&a, r);
        let den = horner(&b, r) + 1.0;
        return num / den;
    } else {
        let q = (-2.0 * (1.0 - p).ln()).sqrt();
        let num = horner(&c, q);
        let den = horner(&d, q) + 1.0;
        return -(num / den);
    }
}

/// Horner. Les coefficients sont stockes du terme de plus bas degre (coeffs[0])
/// au plus haut degre ; on evalue en ordre inverse (du dernier au premier).
fn horner(coeffs: &[f64], x: f64) -> f64 {
    let mut acc = 0.0;
    for &c in coeffs.iter().rev() {
        acc = acc * x + c;
    }
    acc
}

/// Calcule VaR/CVaR completes sur un tableau de P&L.
pub fn calculate_at(pnls: &[f64], confidence: f64) -> VaRResult {
    if pnls.len() < 2 {
        return VaRResult {
            historical_var: 0.0,
            parametric_var: 0.0,
            cvar: 0.0,
            confidence_level: confidence,
            sample_size: pnls.len(),
            mean_pnl: if pnls.len() == 1 { pnls[0] } else { 0.0 },
            std_dev: 0.0,
        };
    }
    let mean = pnls.iter().sum::<f64>() / pnls.len() as f64;
    let variance = pnls.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / pnls.len() as f64;
    let std_dev = variance.sqrt();

    let historical = var_historical(pnls, confidence);
    let z = norm_inv(confidence);
    let parametric = -(mean - z * std_dev).min(0.0);
    let expected_shortfall = cvar(pnls, confidence);

    VaRResult {
        historical_var: historical.max(0.0),
        parametric_var: parametric.max(0.0),
        cvar: expected_shortfall.max(0.0),
        confidence_level: confidence,
        sample_size: pnls.len(),
        mean_pnl: (mean * 100.0).round() / 100.0,
        std_dev: (std_dev * 100.0).round() / 100.0,
    }
}

/// Fenetre glissante pour observations incrementales.
pub struct VarTracker {
    window: std::collections::VecDeque<f64>,
    window_size: usize,
    confidence: f64,
}

impl VarTracker {
    pub fn new(window_size: usize, confidence: f64) -> Self {
        Self {
            window: std::collections::VecDeque::with_capacity(window_size),
            window_size,
            confidence,
        }
    }

    pub fn add(&mut self, pnl: f64) {
        if self.window.len() >= self.window_size {
            self.window.pop_front();
        }
        self.window.push_back(pnl);
    }

    pub fn pnls(&self) -> Vec<f64> {
        self.window.iter().copied().collect()
    }

    pub fn result(&self) -> VaRResult {
        let pnls = self.pnls();
        calculate_at(&pnls, self.confidence)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn var_empty_window_zero() {
        let r = calculate_at(&[], 0.95);
        assert_eq!(r.historical_var, 0.0);
        assert_eq!(r.cvar, 0.0);
        assert_eq!(r.sample_size, 0);
    }

    #[test]
    fn var_single_observation_zero() {
        let r = calculate_at(&[-100.0], 0.95);
        assert_eq!(r.historical_var, 0.0);
    }

    #[test]
    fn var_never_negative() {
        let pnls = vec![10.0, 20.0, 30.0];
        let r = calculate_at(&pnls, 0.95);
        assert!(r.historical_var >= 0.0);
        assert!(r.parametric_var >= 0.0);
        assert!(r.cvar >= 0.0);
    }

    #[test]
    fn cvar_exceeds_var_for_skewed_dists() {
        // Distribution asymetrique : grosse queue de perte.
        let pnls = vec![100.0, 90.0, 80.0, -50.0, -60.0, -200.0, -250.0, -300.0, -400.0];
        let r = calculate_at(&pnls, 0.95);
        assert!(r.cvar >= r.historical_var, "cvar {} < var {}", r.cvar, r.historical_var);
    }

    #[test]
    fn historical_var_matches_percentile() {
        let pnls = vec![-1.0, -2.0, -3.0, -4.0, -5.0, -6.0, -7.0, -8.0, -9.0, -10.0];
        let r = calculate_at(&pnls, 0.95);
        // 5% quantile sur 10 => index 0 => pire perte => var = 10
        assert!((r.historical_var - 10.0).abs() < 0.05, "var = {}", r.historical_var);
    }

    #[test]
    fn tracker_keeps_window_bound() {
        let mut t = VarTracker::new(3, 0.95);
        t.add(1.0);
        t.add(2.0);
        t.add(3.0);
        t.add(4.0);
        assert_eq!(t.pnls(), vec![2.0, 3.0, 4.0]);
    }
}
