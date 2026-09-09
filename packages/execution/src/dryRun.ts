/**
 * Dry-run pour la couche execution.
 *
 * Le flag global vit dans @pallas/core (isDryRun / disableDryRun('LIVE')).
 * Cette facade quant a elle ne fait que LIRE l'etat (sans jamais le modifier),
 * de sorte que tous les adaptateurs (Polymarket, autres exchanges) sont
 * fail-closed tant que le flag global est true.
 */

import { isDryRun } from '@pallas/core';

/** Renvoie true si les ecritures doivent etre bloquees (cas par defaut). */
export function getIsDryRun(): boolean {
  return isDryRun();
}