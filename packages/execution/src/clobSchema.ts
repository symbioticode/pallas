/**
 * Schemas Zod de validation runtime des reponses de l'API CLOB Polymarket
 * (PALLAS-M04). Tout JSON recu qui ne respecte pas la forme attendue est
 * REJETE (ClobValidationError) — jamais substitué silencieusement par un NaN
 * ou une valeur par defaut.
 *
 * Formes de reference — VERIFIEES SUR L'API LIVE le 2026-09-09 (le format
 * documente precedemment a change cote serveur) :
 * - `/markets` : `{ data: [{ condition_id, question, fpmm, neg_risk, active,
 *   closed, accepting_orders, end_date_iso, tokens: [{ token_id, outcome,
 *   price?, winner? }] }], next_cursor? }` — PLUS de `id`/`clob_token_ids`/
 *   `best_bid`/`best_ask` au niveau marche.
 * - `/book`    : `{ market, asset_id, timestamp, hash,
 *   bids: [{ price, size }], asks: [{ price, size }], min_order_size?, ... }`
 *   — buckets en OBJETS `{price, size}` (les paires `[price, size]` sont
 *   rejetees).
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

/** Token d'outcome d'un marche `GET /markets` (shape live 2026-09-09).
 * `outcome` n'est PAS bride a 'Yes'/'No' : l'API live porte des libelles libres
 * (ex. 'Democratic'/'Republican', parfois '' sur des marches pas encore nes).
 * Un `token_id` vide reste possible : a la lecture il devient `null` (aucune
 * valeur inventee), jamais un identifiant exploitable. */
const MarketTokenSchema = z
  .object({
    token_id: z.string().optional(),
    outcome: z.string().optional(),
    price: DecimalSchema.nullable().optional(),
    winner: z.boolean().nullable().optional(),
  })
  .passthrough();

/** Un marche /markets tel que renvoye par `data[]`.
 * `condition_id`/`question` peuvent etre '' sur des marches pas encore nes :
 * acceptes, jamais remplaces — l'identite vide reste honnete (aucune valeur inventee). */
export const MarketSchema = z
  .object({
    condition_id: z.string(),
    question: z.string(),
    end_date_iso: z.string().nullable().optional(),
    fpmm: z.string().optional(),
    neg_risk: z.boolean().nullable().optional(),
    active: z.union([z.boolean(), z.string()]).nullable().optional(),
    closed: z.union([z.boolean(), z.string()]).nullable().optional(),
    accepting_orders: z.union([z.boolean(), z.string()]).nullable().optional(),
    // Les tokens Yes/No SONT les identifiants d'actifs : sans eux impossible de
    // trader ce marche. `tokens` est requis et doit compter >= 2 entites.
    tokens: z.array(MarketTokenSchema).min(2),
  })
  .passthrough();

/** Enveloppe de `GET /markets`. */
export const MarketsResponseSchema = z
  .object({
    data: z.array(MarketSchema),
  })
  .passthrough();

/** Niveau de boucle d'ordres : objet `{ price, size }` (plus de paire `[price, size]`). */
export const OrderbookLevelSchema = z.object({
  price: DecimalSchema,
  size: DecimalSchema,
});

/** Reponse de `GET /book?token_id=...`. */
export const OrderbookSchema = z
  .object({
    market: z.string().optional(),
    asset_id: z.string().optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
    hash: z.string().optional(),
    bids: z.array(OrderbookLevelSchema),
    asks: z.array(OrderbookLevelSchema),
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