#!/usr/bin/env node
/**
 * CLI dry-run Pallas — LECTURES POLYMARKET UNIQUEMENT.
 * Aucune écriture (placeOrder/cancelOrder) n'est exposée, aucune clé requise :
 * ces endpoints sont des reads autorisés en dry-run global (défaut du projet).
 */
import { PolymarketClient } from '@pallas/execution';

function usage() {
  console.log(`Usage :
  pallas-dry-run list-markets [--limit N]   marchés actifs (reads dry-run)
  pallas-dry-run book <tokenId>             orderbook d'un marché`);
}

const [cmd, ...rest] = process.argv.slice(2);

async function main() {
  const client = new PolymarketClient();
  if (cmd === 'list-markets') {
    const idx = rest.indexOf('--limit');
    const limit = idx >= 0 ? Number(rest[idx + 1]) || 10 : 10;
    const markets = await client.listMarkets(limit);
    if (markets.length > limit) {
      // L'API live ignore le parametre limit (~1000 marches archives, tri croissant) :
      // on borne l'affichage, on ne change pas la reponse.
      console.error(`pallas-dry-run: l'API a repondu ${markets.length} marches, affichage des ${limit} premiers`);
    }
    console.log(JSON.stringify(markets.slice(0, limit), null, 2));
    return;
  }
  if (cmd === 'book') {
    const tokenId = rest[0];
    if (!tokenId) throw new Error('tokenId requis : pallas-dry-run book <tokenId>');
    console.log(JSON.stringify(await client.getOrderbook(tokenId), null, 2));
    return;
  }
  usage();
  process.exitCode = cmd ? 2 : 0;
}

main().catch((err) => {
  console.error(`pallas-dry-run: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});