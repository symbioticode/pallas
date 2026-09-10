#!/usr/bin/env node
/**
 * CLI dry-run Pallas — LECTURES POLYMARKET UNIQUEMENT.
 * Aucune ecriture (placeOrder/cancelOrder) n'est exposee, aucune cle requise :
 * ces endpoints sont des reads autorises en dry-run global (defaut du projet).
 *
 * Usage direct (pas besoin du patron npm) :
 *   node scripts/dry-run.mjs ...
 *   ./scripts/dry-run.mjs ...
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PolymarketClient } from '@pallas/execution';

const client = new PolymarketClient();

function usage() {
  console.log(`pallas-dry-run — interface de lecture Polymarket (dry-run)

Commandes :
  list-markets [LIMIT]        marche CLOB (defaut 10, l'API repond ~1000)
  book <tokenId>              orderbook d'un token (best bid/ask, spread)
  prices <tokenId>            cours d'un token (best bid/ask/mid/dernier)
  interactive                 menu numerote : liste -> choix -> book
  browse [LIMIT]              : liste -> choix -> book (alias de interactive)
  --help, -h                  cette aide

Options :
  --json                      sortie JSON brute (au lieu de la table)
  --limit N                   borne de list-markets (equiv. positionnel)

Exemples :
  pallas-dry-run list-markets 5
  pallas-dry-run book 1075058827677314...
  pallas-dry-run interactive`);
}

function builtinList() {
  console.log('pallas-dry-run: LECTURES SEULEMENT — aucun ordre expédié, aucune clé requise.');
}

function parseArgs(rest) {
  const opts = { json: false, limit: 10, positionals: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--json') opts.json = true;
    else if (a === '--limit' && i + 1 < rest.length) { opts.limit = Number(rest[i + 1]) || 10; i += 1; }
    else if (a.startsWith('--')) throw new Error(`option inconnue : ${a}`);
    else opts.positionals.push(a);
  }
  return opts;
}

function pad(s, n) {
  const t = String(s ?? '');
  return t.length >= n ? t.slice(0, n - 1) + '…' : t.padEnd(n);
}

function fmtMarket(m, i) {
  const flag = m.active ? '[ACTIF]  ' : '        ';
  const id = m.id && m.id.length ? m.id.slice(0, 12) + '…' : '(sans id)';
  return `${flag}${String(i + 1).padStart(3)}.  ${pad(m.question, 58)}  fin ${m.endDate ?? '?'}  ${id}`;
}

function printMarkets(markets) {
  builtinList();
  console.log(`Marches (${markets.length} affiches) :\n`);
  markets.forEach((m, i) => console.log(fmtMarket(m, i)));
}

function fmtBook(tag, book) {
  if (!book) return null;
  const bestBid = book.bids[0];
  const bestAsk = book.asks[0];
  const spread = bestBid && bestAsk ? (bestAsk.price - bestBid.price).toFixed(4) : '?';
  const mid = bestBid && bestAsk ? ((bestBid.price + bestAsk.price) / 2).toFixed(4) : '?';
  return [
    `${tag}: best bid ${bestBid ? `${bestBid.price} x ${bestBid.size}` : '—'}`,
    `${' '.repeat(tag.length)}  best ask ${bestAsk ? `${bestAsk.price} x ${bestAsk.size}` : '—'}`,
    `${' '.repeat(tag.length)}  mid ${mid}  |  spread ${spread}  |  niveaux ${(book.bids?.length ?? 0)}/${(book.asks?.length ?? 0)}`,
  ].join('\n');
}

async function showBook(tokenId, tag) {
  try {
    return await client.getOrderbook(tokenId);
  } catch (err) {
    console.error(`pallas-dry-run: book ${tag}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function interactive() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const N = 15;
  try {
    builtinList();
    console.log('Chargement des marches…');
    const all = await client.listMarkets(N);
    if (all.length > N) {
      console.error(`pallas-dry-run: l'API a repondu ${all.length} marches, liste bornee a ${N}`);
    }
    const markets = all.slice(0, N);
    printMarkets(markets);
    for (;;) {
      let ans;
      try {
        ans = (await rl.question('\nChoisir un marche (n°), q pour quitter, r pour rafraichir : ')).trim();
      } catch {
        break; // stdin ferme (pipeline, Ctrl-D) : on quitte proprement.
      }
      if (!ans || ans === 'q' || ans === 'quit') break;
      if (ans === 'r') {
        const refreshed = await client.listMarkets(N);
        markets.length = 0;
        markets.push(...refreshed.slice(0, N));
        printMarkets(markets);
        continue;
      }
      const idx = Number(ans) - 1;
      const m = markets[idx];
      if (!m) {
        console.log(`numero invalide (1..${markets.length})`);
        continue;
      }
      console.log(`\n${m.question}`);
      if (!m.yesTokenId) {
        console.log('  (marche sans token Yes/No exploitable — non tradable par le bot)');
        continue;
      }
      const [yes, no] = await Promise.all([
        showBook(m.yesTokenId, 'Yes'),
        showBook(m.noTokenId, 'No'),
      ]);
      console.log('  ' + [fmtBook('Yes', yes), fmtBook('No', no)].filter(Boolean).join('\n  '));
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h') {
    usage();
    process.exitCode = cmd ? 0 : 0;
    return;
  }
  if (cmd === 'list-markets' || cmd === 'browse') {
    const opts = parseArgs(rest);
    // --limit N et positionnel numerique (list-markets 5) coherents.
    if (opts.positionals.length && /^\d+$/.test(opts.positionals[opts.positionals.length - 1])) {
      opts.limit = Number(opts.positionals.pop());
    }
    const markets = await client.listMarkets(opts.limit);
    if (markets.length > opts.limit) {
      console.error(`pallas-dry-run: l'API a repondu ${markets.length} marches, affichage des ${opts.limit} premiers`);
    }
    const shown = markets.slice(0, opts.limit);
    if (opts.json) console.log(JSON.stringify(shown, null, 2));
    else printMarkets(shown);
    return;
  }
  if (cmd === 'book' || cmd === 'prices') {
    const opts = parseArgs(rest);
    const tokenId = opts.positionals[0];
    if (!tokenId) throw new Error(`tokenId requis : pallas-dry-run ${cmd} <tokenId>`);
    const book = await client.getOrderbook(tokenId);
    if (opts.json) {
      console.log(JSON.stringify(book, null, 2));
      return;
    }
    const l = cmd === 'prices' ? 'Cours' : 'Book';
    console.log(fmtBook(l, book));
    return;
  }
  if (cmd === 'interactive') {
    await interactive();
    return;
  }
  usage();
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(`pallas-dry-run: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});