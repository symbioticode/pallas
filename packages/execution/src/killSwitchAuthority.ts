/**
 * PALLAS-M25 — sous-chemin RÉSERVÉ de l'autorité de kill switch (orchestrateur).
 *
 * `@pallas/execution/kill-switch-authority` est le SEUL chemin d'import donnant accès à
 * `setGlobalKillSwitch`. Il est séparé de l'entrée principale pour qu'aucun consommateur
 * ne puisse désengager la dernière ligne de défense par un import accidentel.
 *
 * L'autorité la PLUS FORTE reste le fichier-drapeau externe (.pallas/KILL) :
 * `setGlobalKillSwitch(false)` ne peut PAS l'annuler.
 */
export { setGlobalKillSwitch } from './killSwitch.js';