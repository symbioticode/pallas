//! Circuit breaker — arrete le trading apres pertes consecutives ou perte cumulee.
//!
//! Multi-scope : un breaker global, des breakers par strategie/marche.
//! Quand le breaker est ouvert (tripped), tous les trades sont refusés.
//!
//! Machine a etats : Closed -> Open (tripped) -> HalfOpen (apres
//! `recovery_observations` observations passees) -> Closed (probe positive).
//! En HalfOpen, un pnl negatif rouvre immediatement le breaker (faillure
//! rapide, fail-closed).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BreakerState {
    Closed,
    HalfOpen,
    Open,
}

/// Etat dynamique du breaker, serialisable pour le transport via le contrat
/// CLI (persiste par l'appelant entre deux appels).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CircuitBreakerSnapshot {
    pub state: BreakerState,
    pub consecutive_losses: usize,
    pub cumulative_pnl: f64,
    pub peak_pnl: f64,
    pub since_trip: usize,
}

pub struct CircuitBreakerConfig {
    /// Nombre de pertes consecutives avant ouverture.
    pub max_consecutive_losses: usize,
    /// Perte cumulee (valeur absolue en USD) déclenchant l'ouverture.
    pub max_drawdown_usd: f64,
    /// Apres combien d'observations on repasse de half-open a closed (re-arm).
    pub recovery_observations: usize,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            max_consecutive_losses: 5,
            max_drawdown_usd: 1000.0,
            recovery_observations: 20,
        }
    }
}

impl Default for CircuitBreaker {
    fn default() -> Self {
        Self::new(CircuitBreakerConfig::default())
    }
}

pub struct CircuitBreaker {
    config: CircuitBreakerConfig,
    state: BreakerState,
    consecutive_losses: usize,
    cumulative_pnl: f64,
    peak_pnl: f64,
    since_trip: usize,
}

impl CircuitBreaker {
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            config,
            state: BreakerState::Closed,
            consecutive_losses: 0,
            cumulative_pnl: 0.0,
            peak_pnl: 0.0,
            since_trip: 0,
        }
    }

    pub fn state(&self) -> BreakerState {
        self.state
    }

    /// Invoque l'etat de la machine a etats pour un nouveau P&L realise.
    ///
    /// - `Closed` : met a jour la perte cumulee et ouvre si seuils depasses.
    /// - `Open` : on n'applique PAS le pnl (protection), on compte des
    ///   observations ; apres `recovery_observations`, on passe a `HalfOpen`.
    /// - `HalfOpen` : trade de sonde. Un pnl negative rouvre immediatement ;
    ///   un pnl >= 0 re-arme completement (Closed), remise a zero de l'etat.
    pub fn record_pnl(&mut self, pnl: f64) {
        match self.state {
            BreakerState::Open => {
                self.since_trip += 1;
                if self.since_trip >= self.config.recovery_observations {
                    self.state = BreakerState::HalfOpen;
                    self.since_trip = 0;
                }
            }
            BreakerState::HalfOpen => {
                if pnl < 0.0 {
                    // la sonde echoue : on rouve, nouveau cycle de recovery.
                    self.state = BreakerState::Open;
                    self.since_trip = 0;
                } else {
                    // la sonde reussit : re-arm complet.
                    self.state = BreakerState::Closed;
                    self.consecutive_losses = 0;
                    self.cumulative_pnl = 0.0;
                    self.peak_pnl = 0.0;
                    self.since_trip = 0;
                }
            }
            BreakerState::Closed => {
                self.cumulative_pnl += pnl;
                if self.cumulative_pnl > self.peak_pnl {
                    self.peak_pnl = self.cumulative_pnl;
                }
                let drawdown = self.peak_pnl - self.cumulative_pnl;

                if pnl < 0.0 {
                    self.consecutive_losses += 1;
                } else {
                    self.consecutive_losses = 0;
                }

                let exceeded_losses = self.consecutive_losses >= self.config.max_consecutive_losses;
                let exceeded_drawdown = drawdown >= self.config.max_drawdown_usd;

                if exceeded_losses || exceeded_drawdown {
                    self.state = BreakerState::Open;
                    self.since_trip = 0;
                }
            }
        }
    }

    pub fn is_open(&self) -> bool {
        self.state == BreakerState::Open
    }

    /// Snapshot serialisable pour le contrat CLI (transport entre appels).
    pub fn snapshot(&self) -> CircuitBreakerSnapshot {
        CircuitBreakerSnapshot {
            state: self.state,
            consecutive_losses: self.consecutive_losses,
            cumulative_pnl: self.cumulative_pnl,
            peak_pnl: self.peak_pnl,
            since_trip: self.since_trip,
        }
    }

    /// Restaure l'etat depuis un snapshot recu (persistance par l'appelant).
    /// La configuration reste celle par defaut (pas de reglage par l'API).
    pub fn restore(&mut self, snap: &CircuitBreakerSnapshot) {
        self.state = snap.state;
        self.consecutive_losses = snap.consecutive_losses;
        self.cumulative_pnl = snap.cumulative_pnl;
        self.peak_pnl = snap.peak_pnl;
        self.since_trip = snap.since_trip;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closed_by_default() {
        let cb = CircuitBreaker::new(CircuitBreakerConfig::default());
        assert!(!cb.is_open());
        assert_eq!(cb.state(), BreakerState::Closed);
    }

    #[test]
    fn opens_after_consecutive_losses() {
        let mut cb = CircuitBreaker::new(CircuitBreakerConfig {
            max_consecutive_losses: 3,
            ..Default::default()
        });
        cb.record_pnl(-10.0);
        cb.record_pnl(-10.0);
        assert!(!cb.is_open());
        cb.record_pnl(-10.0);
        assert!(cb.is_open());
        assert_eq!(cb.state(), BreakerState::Open);
    }

    #[test]
    fn opens_on_drawdown() {
        let mut cb = CircuitBreaker::new(CircuitBreakerConfig {
            max_drawdown_usd: 100.0,
            ..Default::default()
        });
        cb.record_pnl(50.0);
        cb.record_pnl(-80.0);
        cb.record_pnl(-80.0); // drawdown cumule = 110 >= 100
        assert!(cb.is_open());
    }

    #[test]
    fn no_trip_with_alternating_pnl() {
        let mut cb = CircuitBreaker::new(CircuitBreakerConfig {
            max_consecutive_losses: 3,
            ..Default::default()
        });
        cb.record_pnl(-10.0);
        cb.record_pnl(10.0);
        cb.record_pnl(-10.0);
        assert!(!cb.is_open());
    }

    #[test]
    fn open_to_half_open_to_closed_full_transition() {
        let mut cb = CircuitBreaker::new(CircuitBreakerConfig {
            max_consecutive_losses: 2,
            recovery_observations: 3,
            ..Default::default()
        });
        // Closed -> Open apres 2 pertes consecutives.
        cb.record_pnl(-1.0);
        cb.record_pnl(-1.0);
        assert_eq!(cb.state(), BreakerState::Open);

        // Open : 3 observations sans pnl applique -> HalfOpen.
        cb.record_pnl(-5.0);
        cb.record_pnl(-5.0);
        assert_eq!(cb.state(), BreakerState::Open, "pas encore 3 obs");
        cb.record_pnl(-5.0);
        assert_eq!(cb.state(), BreakerState::HalfOpen, "apres 3 obs on passe half-open");

        // HalfOpen : un pnl perte rouvre; un pnl positif re-arme.
        cb.record_pnl(-5.0);
        assert_eq!(cb.state(), BreakerState::Open, "sonde perte -> re-open");

        // Retraversons HalfOpen puis le re-arm ferme.
        cb.record_pnl(1.0);
        cb.record_pnl(1.0);
        cb.record_pnl(1.0);
        assert_eq!(cb.state(), BreakerState::HalfOpen);
        cb.record_pnl(3.0);
        assert_eq!(cb.state(), BreakerState::Closed, "sonde gagnante -> closed");
        assert!(!cb.is_open());
    }

    #[test]
    fn half_open_probe_loss_reopens() {
        let mut cb = CircuitBreaker::new(CircuitBreakerConfig {
            max_consecutive_losses: 1,
            recovery_observations: 1,
            ..Default::default()
        });
        cb.record_pnl(-1.0);
        assert_eq!(cb.state(), BreakerState::Open);
        cb.record_pnl(0.0); // 1 observation -> HalfOpen
        assert_eq!(cb.state(), BreakerState::HalfOpen);
        cb.record_pnl(-1.0); // sonde perte -> re-open immediat
        assert_eq!(cb.state(), BreakerState::Open);
    }

    #[test]
    fn snapshot_roundtrip_preserves_state() {
        let mut cb = CircuitBreaker::new(CircuitBreakerConfig {
            max_consecutive_losses: 2,
            recovery_observations: 3,
            ..Default::default()
        });
        cb.record_pnl(-1.0);
        cb.record_pnl(-1.0);
        assert!(cb.is_open());

        let snap = cb.snapshot();
        let mut restored = CircuitBreaker::default();
        restored.restore(&snap);
        assert_eq!(restored.state(), BreakerState::Open);
        assert!(restored.is_open());
        assert_eq!(restored.snapshot(), snap);
    }
}
