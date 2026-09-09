/**
 * Configuration globale — un seul schema Zod, fail-closed sur les leviers
 * de securite critiques (dry-run, credentials key).
 */

import { z } from 'zod';
import { isDryRun, disableDryRun, getDryRunState } from './dry-run.js';

export const TradingConfigSchema = z.object({
  // Firewall de securite : si ce champ est explicitement 'false', on exige
  // la confirmation LIVE au demarrage.
  dryRun: z.boolean().default(true),
});

export const CredentialConfigSchema = z.object({
  // La longueur minimale n'est pas enforcee ici : en dry-run par defaut on
  // charge une cle vide. La severite (MissingCredentialKeyError, longueur)
  // est appliquee fail-closed a l'usage reel dans credentials.ts.
  key: z.string().default(''),
});

export const GatewayConfigSchema = z.object({
  port: z.number().int().positive().default(18789),
  bind: z.string().default('127.0.0.1'),
  // authToken non contraint au chargement ; la validation d'acces se fait
  // a la demande dans le gateway (fail-closed en cas d'absence).
  authToken: z.string().default(''),
  rateLimitPerMinute: z.number().int().positive().default(100),
});

export const AppConfigSchema = z.object({
  trading: TradingConfigSchema,
  credentials: CredentialConfigSchema,
  gateway: GatewayConfigSchema,
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type TradingConfig = z.infer<typeof TradingConfigSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

/**
 * Construit la config. `credentialsKeyProvided` vient d'une source externe
 * (env var/secrets), jamais d'un const silenceux.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = AppConfigSchema.safeParse({
    trading: { dryRun: env.DRY_RUN !== 'false' },
    credentials: { key: env.PALLAS_CREDENTIAL_KEY ?? '' },
    gateway: {
      port: env.PALLAS_PORT ? Number(env.PALLAS_PORT) : 18789,
      bind: env.PALLAS_BIND ?? '127.0.0.1',
      authToken: env.PALLAS_AUTH_TOKEN ?? '',
      rateLimitPerMinute: env.PALLAS_RATE_LIMIT ? Number(env.PALLAS_RATE_LIMIT) : 100,
    },
  });

  if (!parsed.success) {
    throw new Error(`Configuration invalide: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Applique les gardiens critiques a partir de la config chargée.
 *
 * En mode live demande par la config (dryRun=false), on exige une confirmation
 * *explicite* (chaîne exacte "LIVE") fournie par un operateur humain. Sans
 * confirmation fournie via ce parcours, on reste fail-closed en dry-run : on
 * ne passe jamais en live par un simple levier de config.
 *
 * @returns true si le mode live est effectivement actif, false si en dry-run.
 */
export function applySafetyGates(config: AppConfig, liveConfirmation?: string): boolean {
  if (config.trading.dryRun) {
    return false; // dry-run par defaut / demande
  }
  // La config demande le mode live : il faut une confirmation humaine exacte.
  if (liveConfirmation === 'LIVE') {
    const result = disableDryRun('LIVE');
    if (!result.warning && !isDryRun()) {
      return true;
    }
  }
  // cas par defaut : dry-run (fail-closed)
  return false;
}

export { getDryRunState, isDryRun };
