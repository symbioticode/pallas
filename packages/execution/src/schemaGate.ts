/**
 * PALLAS-M02, constat 5 : la validation du schéma de signature Polymarket n'est
 * PLUS un booléen libre du constructeur (`signedOrdersValidated`), mais une
 * PREUVE INTERNE unique, verrouillée dans ce module.
 *
 * Procédure de validation à suivre pour passer la constante à `true` en prod
 * (voir PHASE-2.2-procedure.md, étape "validation live") :
 *   1. Comparer les digests produits ici avec un client officiel (vecteurs +
 *      viem, cf. polymarketSigner.test.ts) — fait en PALLAS-M02.
 *   2. Envoyer un ordre de test sur le staging/testnet (jamais mainnet avec
 *      clés réelles) et confirmer l'acceptation CLOB + l'identité du maker.
 *   3. Passer `signatureSchemaValidated = true` ICI, en documentant le probe ;
 *      le commit correspondant doit référencer le journal PALLAS-M02.
 *
 * `__setSignatureSchemaValidatedForTests` est réservé aux tests (vitest) :
 * jamais importé via l'index public, jamais invocable par un appelant
 * constructeur. Toute émission réelle d'ordre passe forcément par ce module.
 */

let signatureSchemaValidated = false;

export class SignatureSchemaNotValidatedError extends Error {
  constructor() {
    super('schema de signature Polymarket non valide (voir schemaGate.ts) : ordre refuse (fail-closed)');
    this.name = 'SignatureSchemaNotValidatedError';
  }
}

/** BLOC à l'émission d'ordre tant que la validation live n'est pas prouvée. */
export function assertSignatureSchemaValidated(): void {
  if (!signatureSchemaValidated) {
    throw new SignatureSchemaNotValidatedError();
  }
}

/** Réservé aux tests unitaires (jamais exporté publiquement, voir index). */
export function __setSignatureSchemaValidatedForTests(v: boolean): void {
  signatureSchemaValidated = v;
}