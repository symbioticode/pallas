import type { ObservatorySnapshot } from './types.js';

function esc(value: unknown): string {
  return String(value ?? 'UNKNOWN').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function value(input: unknown, digits = 4): string {
  return typeof input === 'number' && Number.isFinite(input) ? input.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '') : 'UNKNOWN';
}

function badge(label: string, kind = label.toLowerCase().replaceAll(' ', '-')): string {
  return `<span class="badge badge-${esc(kind)}">${esc(label)}</span>`;
}

export function renderDashboard(snapshot: ObservatorySnapshot): string {
  const execution = snapshot.cycle.execution?.replaceAll('_', ' ').toUpperCase() ?? (snapshot.cycle.status === 'NONE' ? 'NO CYCLE RECORDED' : 'NO EXECUTION YET');
  const warnings = snapshot.warnings.length ? `<div class="warnings">${snapshot.warnings.map((warning) => badge(warning, 'warning')).join('')}</div>` : '';
  return `${warnings}
  <section class="panel system"><header><h2>SYSTEM</h2>${badge(snapshot.system.mode, 'dry-run')}</header>
    <div class="identity"><strong>PALLAS</strong><span>APP v${esc(snapshot.system.version)} · AUDIT BASELINE v0.3 · ${esc(snapshot.system.commit ?? 'COMMIT UNKNOWN')}</span></div>
    <div class="pipeline"><span>MARKET</span><i>→</i><span>SIGNAL</span><i>→</i><span>RISK</span><i>→</i><strong>${esc(execution)}</strong><i>→</i><span>LEDGER</span></div>
    <dl><div><dt>REFERENCE LOOP</dt><dd>${badge(snapshot.system.loop, snapshot.system.loop === 'RUNNING' ? 'allow' : snapshot.system.loop === 'STOPPED' ? 'neutral' : 'warning')}</dd></div><div><dt>LAST EVENT AGE</dt><dd>${snapshot.system.loopAgeSeconds === null ? 'UNKNOWN' : `${snapshot.system.loopAgeSeconds}s`}</dd></div><div><dt>LEDGER</dt><dd>${badge(snapshot.system.ledger)}</dd></div><div><dt>ENTRIES</dt><dd>${snapshot.system.ledgerEntries}</dd></div><div><dt>LAST EVENT</dt><dd>${esc(snapshot.system.lastEventAt)}</dd></div></dl>
  </section>
  <section class="panel state"><header><h2>DURABILITY · STATE</h2>${badge(caseLabel(snapshot.durability.format, snapshot.durability.integrity))}</header>
    <dl class="metrics">
      <div><dt>FORMAT</dt><dd>${esc(snapshot.durability.version === null ? snapshot.durability.format : snapshot.durability.version)}</dd></div>
      <div><dt>INTEGRITY</dt><dd>${badge(snapshot.durability.integrity, snapshot.durability.integrity === 'OK' ? 'allow' : 'warning')}</dd></div>
      <div><dt>ORDERS RECORDED</dt><dd>${snapshot.durability.orderCount}</dd></div>
    </dl>
    <table><thead><tr><th>CORRELATION</th><th>STATUS</th><th>ORDER ID</th><th>MARKET</th></tr></thead><tbody>${
      snapshot.durability.orders.length
        ? snapshot.durability.orders.map((o) => `<tr><td class="mono">${esc(shortUuid(o.correlationId))}</td><td>${badge(o.status, o.status === 'ACKED' ? 'allow' : o.status === 'SUBMITTING' || o.status === 'AMBIGUOUS' ? 'warning' : 'neutral')}</td><td>${esc(o.orderId ?? '—')}</td><td>${esc(shortToken(o.marketId))}</td></tr>`).join('')
        : '<tr><td colspan="4">NO DECISION RECORDED</td></tr>'
    }</tbody></table>
    <p class="timestamp">${snapshot.durability.notes.length ? snapshot.durability.notes.map((note) => esc(note)).join(' · ') : 'État transactionnel cohérent'}</p>
  </section>
  <section class="panel market"><header><h2>MARKET</h2>${badge(snapshot.market.status)}</header>
    <div class="market-name">${esc(snapshot.market.question ?? 'MARKET UNKNOWN')}${snapshot.market.outcome ? ` — ${esc(snapshot.market.outcome)}` : ''}</div><div class="token" title="${esc(snapshot.market.tokenId)}">TOKEN ${esc(shortToken(snapshot.market.tokenId))}</div>
    <dl class="metrics"><div><dt>BEST BID</dt><dd>${value(snapshot.market.bestBid)}</dd></div><div><dt>BEST ASK</dt><dd>${value(snapshot.market.bestAsk)}</dd></div><div><dt>MID</dt><dd>${value(snapshot.market.mid)}</dd></div><div><dt>SPREAD</dt><dd>${value(snapshot.market.spread)}</dd></div></dl>
    <p class="timestamp">DATA ${esc(snapshot.market.timestamp)}${snapshot.market.error ? ` · ${esc(snapshot.market.error)}` : ''}</p>
  </section>
  <section class="panel strategy"><header><h2>STRATEGY · SIGNAL</h2><div>${snapshot.strategy.demoOverride ? badge('DEMO OVERRIDE', 'warning') : ''} ${badge(snapshot.strategy.signal, snapshot.strategy.signal === 'BUY' ? 'allow' : 'neutral')}</div></header>
    <div class="strategy-name">ReferenceStrategy</div><p class="disclaimer">REFERENCE STRATEGY — NON PREDICTIVE</p>
    <dl><div><dt>THRESHOLD</dt><dd>${value(snapshot.strategy.threshold)}</dd></div><div><dt>REQUESTED SIZE</dt><dd>${value(snapshot.strategy.requestedSize)}</dd></div><div><dt>OBSERVED PRICE</dt><dd>${value(snapshot.strategy.observedPrice)}</dd></div></dl>
    <div class="signal-chart"><h3>STRATEGY OBSERVED PRICE · RISK OUTCOME</h3>${renderSignalChart(snapshot.strategy.history)}</div>
  </section>
  <section class="panel risk"><header><h2>RISK</h2>${badge(snapshot.risk.status, snapshot.risk.status === 'ALLOW' ? 'allow' : snapshot.risk.status === 'REJECT' ? 'reject' : 'warning')}</header>
    <dl><div><dt>REJECTED BY</dt><dd>${esc(snapshot.risk.rejectedBy.join(', ') || 'NONE')}</dd></div><div><dt>SUGGESTED SIZE USD</dt><dd>${value(snapshot.risk.suggestedSizeUsd, 2)}</dd></div><div><dt>CIRCUIT BREAKER</dt><dd>${esc(circuitState(snapshot.risk.circuitBreaker))}</dd></div><div><dt>P&amp;L SAMPLES</dt><dd>${snapshot.risk.pnlSampleSize ?? 'UNKNOWN'}</dd></div></dl>
    <table><thead><tr><th>GATE</th><th>ACTION</th><th>REASON</th></tr></thead><tbody>${snapshot.risk.gates.length ? snapshot.risk.gates.map((gate) => `<tr><td>${esc(gate.gate)}</td><td>${badge(gate.action, gate.action === 'Allow' ? 'allow' : 'reject')}</td><td>${esc(gate.reason)}</td></tr>`).join('') : '<tr><td colspan="3">RISK STATE UNAVAILABLE</td></tr>'}</tbody></table>
  </section>
  <section class="panel activity"><header><h2>ACTIVITY</h2><span>${snapshot.activity.length} RECENT</span></header>
    <ol>${snapshot.activity.length ? snapshot.activity.map((entry) => `<li><time>${esc(entry.timestamp)}</time><div><strong>${esc(entry.event)}</strong><span>${esc(summary(entry.event, entry.payload))}</span><details><summary>FULL PAYLOAD</summary><pre>${esc(JSON.stringify(entry.payload, null, 2))}</pre></details></div></li>`).join('') : '<li class="empty">NO CYCLE RECORDED</li>'}</ol>
  </section>`;
}

function shortToken(token: string | null): string { return token ? token.length > 22 ? `${token.slice(0, 10)}…${token.slice(-10)}` : token : 'UNKNOWN'; }
function shortUuid(id: string): string { return id ? (id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id) : 'UNKNOWN'; }
function caseLabel(format: string, integrity: string): string {
  if (integrity === 'CORRUPT') return 'CORRUPT';
  if (format === 'V2') return 'V2 OK';
  if (format === 'LEGACY_V1') return 'LEGACY V1';
  if (format === 'MISSING') return 'MISSING';
  return format;
}
function circuitState(input: unknown): string { return input && typeof input === 'object' && 'state' in input ? String((input as { state: unknown }).state) : 'UNKNOWN'; }
function renderSignalChart(history: ObservatorySnapshot['strategy']['history']): string {
  if (history.length < 2) return '<p class="chart-empty">HISTORIQUE INSUFFISANT — 2 SIGNAUX REQUIS</p>';
  const width = 760, height = 210, left = 42, right = 18, top = 14, bottom = 30;
  const x = (index: number) => left + index / Math.max(1, history.length - 1) * (width - left - right);
  const y = (price: number) => top + (1 - Math.max(0, Math.min(1, price))) * (height - top - bottom);
  const points = history.map((point, index) => `${x(index).toFixed(1)},${y(point.price).toFixed(1)}`).join(' ');
  const guides = [0, 0.25, 0.5, 0.75, 1].map((level) => `<line x1="${left}" y1="${y(level)}" x2="${width - right}" y2="${y(level)}"/><text x="4" y="${y(level) + 4}">${level.toFixed(2)}</text>`).join('');
  const latestThreshold = [...history].reverse().find((point) => point.threshold !== null)?.threshold ?? null;
  const threshold = latestThreshold === null ? '' : `<line class="threshold-line" x1="${left}" y1="${y(latestThreshold)}" x2="${width - right}" y2="${y(latestThreshold)}"/><text class="threshold-label" x="${width - right}" y="${y(latestThreshold) - 5}" text-anchor="end">THRESHOLD ${value(latestThreshold)}</text>`;
  const dots = history.map((point, index) => `<circle class="signal-dot ${point.risk.toLowerCase()}" cx="${x(index)}" cy="${y(point.price)}" r="4"><title>${esc(point.timestamp)} · price ${value(point.price)} · risk ${point.risk}</title></circle>`).join('');
  const time = (timestamp: string) => timestamp.slice(11, 16) || 'UNKNOWN';
  return `<svg class="history" viewBox="0 0 ${width} ${height}" role="img" aria-label="Évolution du prix des signaux de référence"><g class="chart-guides">${guides}</g>${threshold}<polyline class="signal-line" points="${points}"/><g>${dots}</g><text class="axis-label" x="${left}" y="${height - 8}">${esc(time(history[0]!.timestamp))}</text><text class="axis-label" x="${width - right}" y="${height - 8}" text-anchor="end">${esc(time(history.at(-1)!.timestamp))}</text><text class="point-count" x="${width - right}" y="${top + 10}" text-anchor="end">${history.length} SIGNAUX</text></svg><div class="chart-legend"><span class="allow">● ALLOW</span><span class="reject">● REJECT</span><span>— PRIX OBSERVÉ</span><span>-- SEUIL</span></div>`;
}
function summary(event: string, payload: unknown): string {
  const p = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  if (event === 'signal') return `${p['side'] ?? 'BUY'} ${shortToken(typeof p['tokenId'] === 'string' ? p['tokenId'] : null)} @ ${value(p['price'])}`;
  if (event === 'risk_decision') return (p['decision'] as { allowed?: boolean } | undefined)?.allowed ? 'ALLOW' : 'REJECT';
  if (event === 'execution_dry_run_blocked') return 'Order transmission blocked by dry-run';
  if (event === 'no_signal') return 'Reference rule produced no signal';
  if (event === 'cycle_start') return `Cycle ${p['cycle'] ?? 'UNKNOWN'}`;
  if (event === 'execution_error') return String(p['error'] ?? 'Execution error');
  if (event === 'execution_success') return 'Execution reported success';
  if (event === 'threat_detected') return `${Array.isArray(p['threats']) ? p['threats'].length : p['threats'] ?? 'UNKNOWN'} threat(s)`;
  if (event === 'external_text_sanitized') return p['modified'] ? 'External text modified' : 'External text unchanged';
  return 'Recorded event';
}
