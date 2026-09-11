/**
 * PALLAS-M14 — état global du kill switch (autorité d'émission).
 *
 * Défense en profondeur : le risk engine rejette les trades quand le kill
 * switch est engagé (port KILL_SWITCH, pipeline.rs). MAIS un appelant pourrait
 * construire un ordre sans repasser par le risk engine. Ce module donne au
 * point d'émission la MÊME vérité : `placeOrder` vérifie l'engagement AVANT
 * tout POST et refuse (KillSwitchEngagedError), en plus de la porte risk.
 *
 * La valeur est positionnée par l'orchestrateur depuis l'état durable
 * (`setGlobalKillSwitch`), exactement comme `isDryRun` global (dryRun.ts).
 * Réservé comme autorité indépendante — M17 restreindra l'accessibilité des
 * deux flags.
 */

let killSwitchEngaged = false;

export class KillSwitchEngagedError extends Error {
  constructor() {
    super(
      'Global kill switch is ENGAGED: order emission blocked at the client ' +
        '(KillSwitchEngagedError) — defense in depth, en plus du risk engine',
    );
    this.name = 'KillSwitchEngagedError';
  }
}

/** Vérité courante de l'émission : engagé ⇒ aucun ordre ne doit partir. */
export function getGlobalKillSwitch(): boolean {
  return killSwitchEngaged;
}

/** Positionné par l'orchestrateur (propriétaire de l'état durable). */
export function setGlobalKillSwitch(engaged: boolean): void {
  killSwitchEngaged = engaged;
}