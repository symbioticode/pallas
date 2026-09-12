import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, type SnapshotOptions } from './snapshot.js';
import { renderDashboard } from './render.js';
import { page } from './page.js';

export interface RouteResponse { status: number; contentType: string; body: string; headers?: Record<string, string> }

export function createReadOnlyRouter(options: SnapshotOptions) {
  return async (method: string, url: string): Promise<RouteResponse> => {
    if (method !== 'GET') return { status: 405, contentType: 'text/plain; charset=utf-8', body: 'METHOD NOT ALLOWED — OBSERVATORY IS READ-ONLY\n', headers: { Allow: 'GET' } };
    const pathname = new URL(url, 'http://localhost').pathname;
    if (pathname === '/') return { status: 200, contentType: 'text/html; charset=utf-8', body: page };
    if (pathname === '/api/snapshot') {
      const snapshot = await buildSnapshot(options);
      return { status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ generatedAt: snapshot.generatedAt, html: renderDashboard(snapshot) }), headers: { 'Cache-Control': 'no-store' } };
    }
    // PALLAS-M20 — status compact (dry-run/kill switch/ordinateur/état réel
    // après un cycle de l'orchestrateur). JSON léger pour ingestion opérationnelle.
    if (pathname === '/api/status') {
      const snapshot = await buildSnapshot(options);
      const marketAgeMs =
        snapshot.market.status === 'STALE'
          ? snapshot.market.timestamp !== null
            ? Math.max(0, Date.now() - Date.parse(snapshot.market.timestamp))
            : null
          : null;
      const critical =
        snapshot.alerts.length > 0 ||
        snapshot.warnings.includes('LEDGER INVALID') ||
        snapshot.warnings.some((w) => w.includes('CORRUPT')) ||
        snapshot.warnings.some((w) => w.includes('RECONCILIATION')) ||
        Boolean(snapshot.durability.killSwitchEngaged);
      const body = {
        generatedAt: snapshot.generatedAt,
        status: 'OK',
        mode: snapshot.system.mode,
        dryRun: { status: snapshot.system.mode === 'DRY RUN' ? 'ENABLED' : 'DISABLED', confirmedLive: false },
        ledger: { status: snapshot.system.ledger, signed: snapshot.system.ledgerSigned, entries: snapshot.system.ledgerEntries, lastEventAt: snapshot.system.lastEventAt },
        loop: { status: snapshot.system.loop, ageSeconds: snapshot.system.loopAgeSeconds },
        cycle: { status: snapshot.cycle.status, execution: snapshot.cycle.execution },
        killSwitch: { engaged: snapshot.durability.killSwitchEngaged },
        orders: { total: snapshot.durability.orderCount, live: snapshot.durability.liveOrders, reconciling: snapshot.durability.reconcilingOrders, liveExposureUsd: snapshot.risk.liveExposureUsd },
        market: { status: snapshot.market.status, tokenId: snapshot.market.tokenId, bestBid: snapshot.market.bestBid, bestAsk: snapshot.market.bestAsk, timestamp: snapshot.market.timestamp, ageMs: marketAgeMs },
        alerts: snapshot.alerts,
        warnings: snapshot.warnings,
        critical,
      };
      return { status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body), headers: { 'Cache-Control': 'no-store' } };
    }
    return { status: 404, contentType: 'text/plain; charset=utf-8', body: 'NOT FOUND\n' };
  };
}

function send(res: ServerResponse, response: RouteResponse): void {
  res.writeHead(response.status, { 'Content-Type': response.contentType, 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', ...response.headers });
  res.end(response.body);
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(currentDir, '../../..');

export function startServer(options: SnapshotOptions, port: number, host = '127.0.0.1') {
  const route = createReadOnlyRouter(options);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => { route(req.method ?? '', req.url ?? '/').then((response) => send(res, response)).catch(() => send(res, { status: 500, contentType: 'text/plain; charset=utf-8', body: 'SNAPSHOT UNAVAILABLE\n' })); });
  return server.listen(port, host, () => console.log(`Pallas Observatory (READ-ONLY / DRY RUN) http://${host}:${port}`));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDir = resolve(process.env.PALLAS_OBSERVATORY_ROOT ?? defaultRoot);
  startServer({ rootDir, tokenId: process.env.PALLAS_REF_TOKEN_ID?.split(',')[0]?.trim() || undefined,
    marketQuestion: process.env.PALLAS_REF_MARKET_QUESTION,
    marketOutcome: process.env.PALLAS_REF_MARKET_OUTCOME,
    demoOverride: process.env.PALLAS_OBSERVATORY_DEMO_OVERRIDE === 'true',
    threshold: process.env.PALLAS_REF_THRESHOLD ? Number(process.env.PALLAS_REF_THRESHOLD) : undefined,
    size: process.env.PALLAS_REF_SIZE ? Number(process.env.PALLAS_REF_SIZE) : undefined }, Number(process.env.PALLAS_OBSERVATORY_PORT ?? '4173'));
}
