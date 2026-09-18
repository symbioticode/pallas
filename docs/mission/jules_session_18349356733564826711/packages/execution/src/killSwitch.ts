/**
 * PALLAS-M14 / PALLAS-M25 — état global du kill switch (autorité d'émission).
 *
 * Défense en profondeur : le risk engine rejette les trades quand le kill switch
 * est engagé (port KILL_SWITCH, pipeline.rs). MAIS un appelant pourrait construire
 * un ordre sans repasser par le risk engine. Ce module donne au point d'émission la
 * MÊME vérité : `placeOrder` vérifie l'engagement AVANT tout POST et refuse
 * (`KillSwitchEngagedError`), en plus de la porte risk.
 *
 * PALLAS-M25 (audit v0.4 F-06) — deux durcissements :
 *  1. La PRIMITIVE DE DÉSENGAGEMENT `setGlobalKillSwitch` n'est PLUS exportée par
 *     l'entrée publique `@pallas/execution`. Elle n'est accessible que par le
 *     sous-chemin RÉSERVÉ `@pallas/execution/kill-switch-authority`, documenté,
 *     utilisé par le seul orchestrateur propriétaire de l'état durable.
 *  2. Une AUTORITÉ EXTERNE au process est ajoutée : la PRÉSENCE du fichier-drapeau
 *     `<PALLAS_KILL_SWITCH_FILE | .pallas/KILL>` engage le kill switch, sans passer par
 *     le code du process. Un code interne ne peut donc plus le désengager silencieusement
 *     en mémoire : `setGlobalKillSwitch(false)` n'annule PAS un fichier présent.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

/** Chemin du fichier-drapeau externe (surchargeable pour tests/ops). */
export function killSwitchFilePath(): string {
  const override = process.env.PALLAS_KILL_SWITCH_FILE;
  return override && override.length > 0 ? resolve(override) : resolve(process.cwd(), '.pallas', 'KILL');
}

/** L'autorité EXTERNE (fichier-drapeau) est-elle engagée ? Vérifiée à chaque appel. */
export function isKillSwitchFileEngaged(): boolean {
  try {
    return existsSync(killSwitchFilePath());
  } catch {
    return false;
  }
}

/**
 * Vérité courante de l'émission : engagé si le flag INTERNE **ou** le fichier
 * externe l'est. Le fichier est une autorité PLUS FORTE : il ne peut pas être
 * désengagé par `setGlobalKillSwitch`.
 */
export function getGlobalKillSwitch(): boolean {
  return killSwitchEngaged || isKillSwitchFileEngaged();
}

/**
 * Positionné par l'orchestrateur (propriétaire de l'état durable).
 * @internal — NON exporté par l'entrée publique (voir killSwitchAuthority.ts).
 */
export function setGlobalKillSwitch(engaged: boolean): void {
  killSwitchEngaged = engaged;
}