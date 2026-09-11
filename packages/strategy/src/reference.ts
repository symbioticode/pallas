/**
 * STRATEGIE DE REFERENCE — NON PREDICTIVE, AUCUN EDGE, AUCUNE VALEUR PREDICTIVE.
 *
 * PALLAS-M12 (mission §1, §6.1) : cette stratégie ne sert QU'UN SEUL but —
 * exercer le pipeline d'intégration (signal -> sanitizer -> risk engine ->
 * execution dry-run -> ledger). Elle lit l'orderbook d'un marché Polymarket
 * FIXE et déclenche un signal BUY quand le best ask descend sous un SEUIL
 * FIXE. AUSSUITÔT ces deux paramètres, il n'y a rien d'autre : aucun paramètre
 * optimisé, aucune donnée historique, aucune estimation de probabilité.
 *
 * NE JAMAIS PRESENTER cette classe comme ayant un edge, même "de démo" : il y a
 * exactement ZÉRO corrélation supposée entre ce signal et la rentabilité. Une
 * stratégie avec prétention de rentabilité exige un backtesting out-of-sample
 * et une mission séparée (docs/STRATEGY.md) avant d'être câblée au même
 * orchestrateur.
 */

/** Signal produit par la stratégie de référence. */
export interface ReferenceSignal {
  tokenId: string;
  side: 'BUY';
  /** price du deal : dernier best ask observé (inférieur au seuil). */
  price: number;
  /** nombre de parts (fixe, configuré). */
  size: number;
  bestAsk: number;
  threshold: number;
  reason: string;
}

export interface ReferenceStrategyConfig {
  /** token_id (yes) des marchés surveillés, dans l'ordre. */
  tokenIds: string[];
  /** Déclenche BUY quand best ask < buyThreshold. Seuil FIXE, non optimisé. */
  buyThreshold: number;
  /** Taille d'ordre fixe en parts. */
  size: number;
}

/** Surface d'orderbook minimale nécessaire à la stratégie (facile à mocker). */
export interface OrderbookLike {
  marketId: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  fetchedAt: string;
}

export interface OrderbookReader {
  getOrderbook(tokenId: string): Promise<OrderbookLike>;
}

/**
 * Règle triviale et déterministe (l'issue ne dépend que du best ask et du
 * seuil) — aucun paramètre optimisé, déterministe donnée-entrée.
 */
export class ReferenceStrategy {
  private readonly config: ReferenceStrategyConfig;

  constructor(config: ReferenceStrategyConfig) {
    if (config.tokenIds.length === 0) {
      throw new Error('ReferenceStrategy: au moins un tokenId requis');
    }
    if (!(config.buyThreshold > 0)) {
      throw new Error('ReferenceStrategy: buyThreshold doit etre > 0');
    }
    if (!(config.size > 0)) {
      throw new Error('ReferenceStrategy: size doit etre > 0');
    }
    this.config = { ...config };
  }

  /** Premier marché de la liste dont le best ask < seuil => signal BUY. */
  async evaluate(reader: OrderbookReader): Promise<ReferenceSignal | null> {
    for (const tokenId of this.config.tokenIds) {
      let book: OrderbookLike;
      try {
        book = await reader.getOrderbook(tokenId);
      } catch {
        // Lecture indisponible = reponse neutre (aucun signal), pas une panne
        // du pipeline. L'orchestrateur journalise l'echec de lecture separement.
        continue;
      }
      const bestAsk = bestAskOf(book);
      if (bestAsk === null) continue; // pas de cote a l'achat -> rien a faire
      if (bestAsk < this.config.buyThreshold) {
        return {
          tokenId,
          side: 'BUY',
          price: bestAsk,
          size: this.config.size,
          bestAsk,
          threshold: this.config.buyThreshold,
          reason: `reference rule: best ask ${bestAsk} < seuil ${this.config.buyThreshold}`,
        };
      }
    }
    return null;
  }
}

/** Best ask d'un orderbook (cotes triees par l'API, premiere = meilleure). */
export function bestAskOf(book: OrderbookLike): number | null {
  if (!Array.isArray(book.asks) || book.asks.length === 0) return null;
  const filled = book.asks.filter((l) => typeof l.price === 'number' && Number.isFinite(l.price));
  if (filled.length === 0) return null;
  return Math.min(...filled.map((l) => l.price));
}