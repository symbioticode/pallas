/**
 * Schemas Zod de validation runtime des reponses de l'API CLOB Polymarket
 * (PALLAS-M04). Tout JSON recu qui ne respecte pas la forme attendue est
 * REJETE (ClobValidationError) — jamais substitué silencieusement par un NaN
 * ou une valeur par defaut.
 *
 * Formes de reference (docs.polymarket.com) :
 * - `/markets` : `{ data: [{ id, question, active, closed, end_date_iso,
 *   clob_token_ids: string[], best_bid?, best_ask? }], ... }`
 * - `/book`    : `{ asset_id, bids: [[price, size], ...], asks: [...] }`
 * - POST /order : `{ success?, errorMsg?, orderID?, status?, ... }`
 */

import { z } from 'zod';

/** Erreur de validation d'une reponse CLOB (frontiere HTTP non fiable). */
export class ClobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClobValidationError';
  }
}

/** Nombre decimal emis par l'API : soit un nombre JSON, soit une chaine decimale non vide. */
const DecimalSchema = z.union([
  z.number().finite(),
  z
    .string()
    .min(1)
    .regex(/^[+-]?(\d+\.?\d*|\.\d+)$/, 'attendu: nombre decimal'),
]);

/** Reponse de la boucle d'ordres : buckets de paires [price, size]. */
const BookLevelSchema = z.tuple([DecimalSchema, DecimalSchema]);

/** Un marche /markets tel que renvoye par `data[]`. */
export const MarketSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    end_date_iso: z.string().nullable().optional(),
    // Identifiants de tokens REQUIS : sans eux, impossible de trader ce marche.
    clob_token_ids: z.array(z.string()),
    best_bid: DecimalSchema.nullable().optional(),
    best_ask: DecimalSchema.nullable().optional(),
    active: z.union([z.boolean(), z.string()]).nullable().optional(),
    closed: z.union([z.boolean(), z.string()]).nullable().optional(),
  })
  .passthrough();

/** Enveloppe de `GET /markets`. */
export const MarketsResponseSchema = z
  .object({
    data: z.array(MarketSchema),
  })
  .passthrough();

/** Reponse de `GET /book?token_id=...`. */
export const OrderbookSchema = z
  .object({
    asset_id: z.string().optional(),
    bids: z.array(BookLevelSchema),
    asks: z.array(BookLevelSchema),
  })
  .passthrough();

/** Reponse de `POST /order` (docs place-orders : success/errorMsg/orderID/status). */
export const PlaceOrderResponseSchema = z
  .object({
    success: z.boolean().optional(),
    errorMsg: z.string().optional(),
    orderID: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();

/** Reponse de `GET /auth/derive-api-key`. */
export const DeriveApiKeyResponseSchema = z
  .object({
    apiKey: z.string().min(1),
    secret: z.string().min(1),
    passphrase: z.string().min(1),
  })
  .passthrough();

/** Parse et rejette toute reponse qui ne respecte pas `schema` (fail-closed). */
export function parseClob<T>(schema: z.ZodType<T>, label: string, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .slice(0, 4)
      .join('; ');
    throw new ClobValidationError(`${label}: reponse CLOB malformee — ${issues}`);
  }
  return r.data;
}