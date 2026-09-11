//! Kelly criterion et position sizing fractionnaire.
//!
//! Le Kelly fractionnaire (half/quarter Kelly) reduit la variance au prix
//! d'une croissance legerement inferieure — c'est la norme en trading reel.

#[derive(Debug, Clone, PartialEq)]
pub struct KellyResult {
    /// Fraction de la bankroll a risquer (0..1).
    pub full_kelly: f64,
    /// Half Kelly.
    pub half_kelly: f64,
    /// Quarter Kelly.
    pub quarter_kelly: f64,
    /// Le bet a-t-il une esperance positive ?
    pub positive_ev: bool,
    /// Taille recommandee en $ pour la bankroll donnee.
    pub recommended_size: f64,
}

/// Kelly pour un bien probabilite/odds.
/// - win_prob : probabilite de gain (0..1)
/// - odds : cote "x : 1" (cote nette ; pour une cote binaire decimale d,
///   odds = d - 1)
/// - bankroll : capital disponible
/// - fraction : facteur de fractionnement (1.0 = full, 0.5 = half, ...)
pub fn kelly_fraction(win_prob: f64, odds: f64, bankroll: f64, fraction: f64) -> KellyResult {
    // f* = (p * (b+1) - 1) / b, ou b = odds nette
    let b = odds;
    let p = win_prob;

    let expected = p * (b + 1.0) - 1.0; // esperance de profit par unité
    let positive_ev = expected > 0.0 && b > 0.0;

    let full = if positive_ev {
        if b > 0.0 {
            (p * (b + 1.0) - 1.0) / b
        } else {
            0.0
        }
    } else {
        0.0
    };

    // borne : jamais plus de 100% ; jamais negatif.
    let full = full.clamp(0.0, 1.0);
    let scaled = full * fraction;
    let scaled = scaled.clamp(0.0, 1.0);

    KellyResult {
        full_kelly: round4(full),
        half_kelly: round4(full * 0.5),
        quarter_kelly: round4(full * 0.25),
        positive_ev,
        recommended_size: round2(scaled * bankroll),
    }
}

fn round4(n: f64) -> f64 {
    (n * 10000.0).round() / 10000.0
}
fn round2(n: f64) -> f64 {
    (n * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negative_ev_zero() {
        // p=0.4, b=0.5 -> expected = 0.4*1.5 - 1 = -0.4 < 0
        let r = kelly_fraction(0.4, 0.5, 1000.0, 1.0);
        assert!(!r.positive_ev);
        assert_eq!(r.full_kelly, 0.0);
        assert_eq!(r.recommended_size, 0.0);
    }

    #[test]
    fn positive_ev_gives_fraction() {
        let r = kelly_fraction(0.6, 2.0, 1000.0, 1.0);
        assert!(r.positive_ev);
        assert!(r.full_kelly > 0.0);
        assert!(r.full_kelly <= 1.0);
    }

    #[test]
    fn half_less_than_full() {
        let half = kelly_fraction(0.6, 2.0, 1000.0, 0.5).recommended_size;
        let full_size = kelly_fraction(0.6, 2.0, 1000.0, 1.0).recommended_size;
        assert!(half < full_size);
    }

    #[test]
    fn never_more_than_bankroll() {
        let r = kelly_fraction(0.99, 1000.0, 1000.0, 1.0);
        assert!(r.recommended_size <= 1000.0);
    }

    #[test]
    fn confidence_lowers_size() {
        let high = kelly_fraction(0.7, 1.0, 1000.0, 1.0);
        let low = kelly_fraction(0.52, 1.0, 1000.0, 1.0);
        assert!(low.recommended_size < high.recommended_size || low.full_kelly <= high.full_kelly);
    }
}
