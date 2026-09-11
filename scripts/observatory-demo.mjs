#!/usr/bin/env node
/** Lanceur local sans configuration. GET publics seulement, aucun credential. */
import { spawn } from 'node:child_process';
import { accessSync, constants, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const observatoryEntry = resolve(root, 'packages/observatory/dist/server.js');
const loopEntry = resolve(root, 'packages/strategy/dist/run-reference-loop.js');
for (const entry of [observatoryEntry, loopEntry]) {
  try { accessSync(entry, constants.R_OK); }
  catch { throw new Error(`build manquant: ${entry}\nLancer d'abord: npm run build`); }
}

function tokenIdsOf(market) {
  const raw = market?.clobTokenIds;
  if (Array.isArray(raw)) return raw.filter((id) => typeof id === 'string' && id.length > 0);
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && id.length > 0) : [];
  } catch { return []; }
}

function outcomesOf(market) {
  const raw = market?.outcomes;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string') return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}

async function getJson(url) {
  const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GET ${new URL(url).pathname}: HTTP ${response.status}`);
  return response.json();
}

async function selectLiquidToken() {
  console.log('Recherche automatique d’un marché Polymarket actif…');
  const query = new URLSearchParams({ active: 'true', closed: 'false', limit: '50', order: 'volume24hr', ascending: 'false' });
  const markets = await getJson(`https://gamma-api.polymarket.com/markets?${query}`);
  if (!Array.isArray(markets)) throw new Error('réponse Gamma inattendue');
  for (const market of markets) {
    if (market?.enableOrderBook === false) continue;
    const tokenIds = tokenIdsOf(market);
    const outcomes = outcomesOf(market);
    for (const [tokenIndex, tokenId] of tokenIds.entries()) {
      try {
        const book = await getJson(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`);
        const asks = Array.isArray(book?.asks) ? book.asks.map((level) => Number(level?.price)).filter(Number.isFinite) : [];
        const ask = asks.length ? Math.min(...asks) : Number.NaN;
        if (ask > 0 && ask < 1) return { tokenId, question: String(market?.question ?? 'Marché sans titre'), outcome: outcomes[tokenIndex] ?? 'OUTCOME UNKNOWN', ask };
      } catch { /* token sans book : essayer le suivant */ }
    }
  }
  throw new Error('aucun marché actif avec orderbook exploitable trouvé');
}

const selected = await selectLiquidToken();
const statusPath = resolve(root, '.pallas/observatory-loop.json');
function writeStatus(status, detail = {}) {
  mkdirSync(resolve(root, '.pallas'), { recursive: true });
  writeFileSync(statusPath, JSON.stringify({ status, timestamp: new Date().toISOString(), ...detail }, null, 2) + '\n', 'utf8');
}
const demoThreshold = process.env.PALLAS_REF_THRESHOLD ?? '1';
const env = { ...process.env, PALLAS_REF_TOKEN_ID: selected.tokenId, PALLAS_REF_THRESHOLD: demoThreshold, PALLAS_REF_SIZE: process.env.PALLAS_REF_SIZE ?? '1', PALLAS_REF_CYCLES: process.env.PALLAS_REF_CYCLES ?? '100', PALLAS_REF_MARKET_QUESTION: selected.question, PALLAS_REF_MARKET_OUTCOME: selected.outcome, PALLAS_OBSERVATORY_DEMO_OVERRIDE: demoThreshold === '1' ? 'true' : 'false' };
console.log(`Marché sélectionné : ${selected.question}`);
console.log(`Best ask actuel    : ${selected.ask}`);
console.log(`Outcome            : ${selected.outcome}`);
console.log(`Token              : ${selected.tokenId.slice(0, 12)}…${selected.tokenId.slice(-10)}`);

const observatory = spawn(process.execPath, [observatoryEntry], { cwd: root, env, stdio: 'inherit' });
let loop;
const timer = setTimeout(() => {
  console.log('Ouvrir : http://127.0.0.1:4173');
  loop = spawn(process.execPath, [loopEntry], { cwd: root, env, stdio: 'inherit' });
  writeStatus('running', { pid: loop.pid });
  loop.on('exit', (code) => { writeStatus('stopped', { exitCode: code }); console.log(`Reference loop terminée (code ${code ?? 'signal'}). Observatory reste disponible; Ctrl-C pour quitter.`); });
}, 700);

function shutdown() {
  clearTimeout(timer);
  if (loop && !loop.killed) loop.kill('SIGTERM');
  if (!observatory.killed) observatory.kill('SIGTERM');
}
process.once('SIGINT', () => { shutdown(); process.exit(130); });
process.once('SIGTERM', () => { shutdown(); process.exit(143); });
observatory.on('exit', (code) => { if (code && code !== 0) { shutdown(); process.exitCode = code; } });
