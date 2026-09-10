//! Propriétés (proptest) garantissant des invariants du risk engine.

use proptest::prelude::*;

// La VaR historique n'est jamais negative.
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn var_never_negative(pnls in prop::collection::vec(-1000.0f64..1000.0, 0..200)) {
        let v = risk_engine::var::var_historical(&pnls, 0.95);
        prop_assert!(v >= 0.0, "var {} < 0", v);
        prop_assert!(v.is_finite());
    }

    #[test]
    fn kelly_never_exceeds_bankroll(
        win_prob in 0.0f64..1.0,
        odds in 0.0f64..10.0,
        bankroll in 0.0f64..10_000_000.0,
        fraction in 0.0f64..1.0,
    ) {
        let k = risk_engine::kelly::kelly_fraction(win_prob, odds, bankroll, fraction);
        prop_assert!(k.recommended_size <= bankroll + 0.001);
        prop_assert!(k.full_kelly >= 0.0 && k.full_kelly <= 1.0);
    }

    #[test]
    fn positive_ev_when_profit_factor_positive(
        win_prob in 0.0f64..1.0,
        odds in 0.01f64..10.0,
    ) {
        let expected = win_prob * (odds + 1.0) - 1.0;
        let k = risk_engine::kelly::kelly_fraction(win_prob, odds, 1000.0, 1.0);
        prop_assert_eq!(k.positive_ev, expected > 0.0);
    }
}
