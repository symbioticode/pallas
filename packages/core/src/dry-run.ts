/**
 * Dry-run global — UN SEUL flag source de verite, true par defaut.
 *
 * Lecon de CloddsBot corrigee :
 *  - CloddsBot: `dryRun: process.env.DRY_RUN === 'true'` disséminé partout => false par défaut.
 *    ET `dryRun: config.trading.dryRun ?? false`. Argent réel par défaut = dangereux.
 *  - Ici : un seul objet mutable `dryRunState`, par défaut `true`. Tout module lit
 *    l'etat via `isDryRun()`. La seule facon de passer en réel est `disableDryRun()`
 *    qui est bruyante et exige une confirmation explicite.
 */

let dryRunEnabled = true;

/** Valeur litterale representant l'etat courant, pour logging/UI. */
export type DryRunState = 'dry-run' | 'live';

export function isDryRun(): boolean {
  return dryRunEnabled;
}

export function getDryRunState(): DryRunState {
  return dryRunEnabled ? 'dry-run' : 'live';
}

export interface DisableDryRunResult {
  enabled: boolean;
  warning: string | null;
}

/**
 * Passe en mode live (argent réel).
 *
 * @param explicitConfirmation - doit etre exactement la chaîne 'LIVE' pour désactiver.
 *   Toute autre valeur refuse la bascule (fail-closed : pas de bascule accidentelle).
 */
export function disableDryRun(explicitConfirmation: string): DisableDryRunResult {
  if (explicitConfirmation !== 'LIVE') {
    return {
      enabled: dryRunEnabled,
      warning:
        'Refus de passer en mode live : la confirmation explicite "LIVE" est requise. ' +
        'Le dry-run reste actif.',
    };
  }
  dryRunEnabled = false;
  // Bruyant par conception : on ne passe jamais en réel sans le dire.
  console.warn(
    '============================================================\n' +
      '!!! DRY-RUN DESACTIVE — ARGENT REEL EN JEU !!!\n' +
      '   Tous les ordres seront envoyés à l\'exchange.\n' +
      '   Pour revenir en simulation, appelez les credentials en mode dry-run.\n' +
      '============================================================'
  );
  return { enabled: dryRunEnabled, warning: null };
}

/**
 * Retourne au mode dry-run (sans confirmation, c'est le mode sur).
 *
 * PALLAS-M17 : usage RESERVE aux tests et à la remise en simulation manuelle
 * par un operateur. NON exporté par le paquet public (`@pallas/core`) : il ne
 * doit JAMAIS être atteignable par un chemin de décision automatisé — un
 * ordre n'a aucun droit de réarmer le dry-run. Seuls `isDryRun` /
 * `getDryRunState` / `disableDryRun('LIVE')` sont publics (l'entrée
 * opérateur explicite reste `applySafetyGates`).
 */
export function enableDryRun(): void {
  dryRunEnabled = true;
}

/** Sert aux tests : remet l'etat par defaut. */
export function resetDryRunForTests(): void {
  dryRunEnabled = true;
}
