#!/usr/bin/env node
/**
 * PALLAS-M27 - superviseur de campagne d'observation multi-jours (dry-run STRICT).
 *
 * Ce script ne fait AUCUNE emission : il verifie le dry-run global AVANT de
 * lancer, fait tourner l'orchestrateur de reference en continu, et mesure :
 *   - la disponibilite (process vivant), les redemarrages ;
 *   - l'evolution du ledger et de l'etat durable (taille, nb d'entrees) ;
 *   - la memoire du process (VmRSS via /proc) dans le temps ;
 *   - les alertes persistees.
 * Il peut injecter un incident controle (SIGKILL puis relance) pour observer la
 * reprise en conditions reelles. Les logs/ledger/etat sont CONSERVES dans le
 * repertoire de campagne (jamais supprimes).
 *
 * Env :
 *   PALLAS_REF_TOKEN_ID          (requis) token CLOB observe
 *   PALLAS_CAMPAIGN_MINUTES      duree cible (defaut 4320 = 72h)
 *   PALLAS_CAMPAIGN_INTERVAL_MS  pause inter-cycles (defaut 30000)
 *   PALLAS_CAMPAIGN_MONITOR_MS   periode de mesure (defaut 30000)
 *   PALLAS_CAMPAIGN_INCIDENT     "1" => SIGKILL a ~40% puis relance
 *   PALLAS_CAMPAIGN_DIR          repertoire de campagne
 *   PALLAS_RISK_BIN              binaire risk-engine (defaut chemin du depot)
 */
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LOOP = join(REPO, "packages", "strategy", "dist", "run-reference-loop.js");
const RISK_BIN = process.env.PALLAS_RISK_BIN || join(REPO, "crates", "risk-engine", "target", "debug", "risk-engine");

function log(obj) { console.log(JSON.stringify(obj)); }
function nowIso() { return new Date().toISOString(); }

let dry = false;
try {
  const mod = await import("@pallas/execution");
  dry = mod.getIsDryRun();
} catch (err) {
  log({ event: "preflight_error", error: String(err && err.message ? err.message : err) });
  process.exit(2);
}
if (dry !== true) { log({ event: "preflight_fatal", reason: "dry-run INACTIF", dry: dry }); process.exit(2); }
if (!existsSync(LOOP)) { log({ event: "preflight_fatal", reason: "loop dist absent", loop: LOOP }); process.exit(2); }
if (!existsSync(RISK_BIN)) { log({ event: "preflight_fatal", reason: "risk binary absent", risk_bin: RISK_BIN }); process.exit(2); }
const token = process.env.PALLAS_REF_TOKEN_ID || "";
if (!token) { log({ event: "preflight_fatal", reason: "PALLAS_REF_TOKEN_ID requis" }); process.exit(2); }

const minutes = Number(process.env.PALLAS_CAMPAIGN_MINUTES || "4320");
const intervalMs = Number(process.env.PALLAS_CAMPAIGN_INTERVAL_MS || "30000");
const monitorMs = Number(process.env.PALLAS_CAMPAIGN_MONITOR_MS || "30000");
const incident = (process.env.PALLAS_CAMPAIGN_INCIDENT || "0") === "1";
const durationMs = Math.max(1, minutes) * 60 * 1000;
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const dir = resolve(process.env.PALLAS_CAMPAIGN_DIR || join(".pallas", "campaign-" + ts));
const dot = join(dir, ".pallas");
const logsDir = join(dir, "logs");
mkdirSync(dot, { recursive: true });
mkdirSync(logsDir, { recursive: true });

const ledgerPath = join(dot, "ledger.json");
const statePath = join(dot, "risk-state.json");
const alertPath = join(dot, "alerts.jsonl");
const metricsPath = join(dir, "metrics.jsonl");

let git = "unknown";
try { git = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch {}

const manifest = { event: "campaign_manifest", started_at: nowIso(), target_minutes: minutes, interval_ms: intervalMs, monitor_ms: monitorMs, incident_injection: incident, token: token, dir: dir, ledger_path: ledgerPath, state_path: statePath, dry_run_verified: true, git_commit: git, node: process.version, risk_bin: RISK_BIN };
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
log(manifest);

function sizeOf(p) { try { return readFileSync(p).length; } catch { return 0; } }
function ledgerEntries(p) { try { const d = JSON.parse(readFileSync(p, "utf8")); return Array.isArray(d.entries) ? d.entries.length : -1; } catch { return -1; } }
function lineCount(p) { try { const s = readFileSync(p, "utf8"); return s.length === 0 ? 0 : s.trim().split("\n").length; } catch { return 0; } }
function rssKb(pid) { try { const s = readFileSync("/proc/" + pid + "/status", "utf8"); const m = s.match(/VmRSS:\s+(\d+)\s+kB/); return m ? Number(m[1]) : null; } catch { return null; } }

const startedAt = Date.now();
let child = null;
let restarts = 0;
let incidents = [];
let maxRss = 0;
let stopping = false;

function snapshot() {
  const pid = child ? child.pid : null;
  const rss = pid ? rssKb(pid) : null;
  if (typeof rss === "number") maxRss = Math.max(maxRss, rss);
  const row = { ts: nowIso(), elapsed_ms: Date.now() - startedAt, alive: child !== null && child.exitCode === null, pid: pid, rss_kb: rss, ledger_entries: ledgerEntries(ledgerPath), ledger_bytes: sizeOf(ledgerPath), state_bytes: sizeOf(statePath), alerts_lines: lineCount(alertPath), alerts_bytes: sizeOf(alertPath), restarts: restarts };
  appendFileSync(metricsPath, JSON.stringify(row) + "\n");
  return row;
}

function startChild() {
  const fd = openSync(join(logsDir, "loop-" + Date.now() + ".log"), "a");
  const env = Object.assign({}, process.env, { PALLAS_REF_TOKEN_ID: token, PALLAS_REF_CYCLES: "100000000", PALLAS_REF_CYCLE_SLEEP_MS: String(intervalMs), PALLAS_ALERT_FILE: alertPath, PALLAS_RISK_BIN: RISK_BIN, PALLAS_LEDGER_MODE: process.env.PALLAS_LEDGER_MODE || "dev" });
  child = spawn(process.execPath, [LOOP], { cwd: dir, env: env, stdio: ["ignore", fd, fd] });
  child.on("exit", function (code, signal) {
    log({ event: "child_exit", code: code, signal: signal, at: nowIso(), elapsed_ms: Date.now() - startedAt });
    if (!stopping) { restarts += 1; setTimeout(function () { if (!stopping) startChild(); }, 2000); }
  });
  log({ event: "child_start", pid: child.pid, at: nowIso(), restarts: restarts });
}

function finish(reason) {
  stopping = true;
  if (child && child.exitCode === null) child.kill("SIGTERM");
  const finalRow = snapshot();
  const summary = { event: "campaign_summary", ended_at: nowIso(), reason: reason, achieved_ms: Date.now() - startedAt, target_ms: durationMs, restarts: restarts, incidents: incidents, max_rss_kb: maxRss, final: finalRow, metrics_path: metricsPath, dir: dir };
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  log(summary);
  setTimeout(function () { process.exit(0); }, 500);
}

const monitor = setInterval(function () {
  const row = snapshot();
  if (incident && incidents.length === 0 && row.elapsed_ms >= durationMs * 0.4 && child && child.pid) {
    incidents.push({ type: "sigkill", at: nowIso(), pid: child.pid });
    log({ event: "incident_injected", type: "sigkill", pid: child.pid });
    child.kill("SIGKILL");
  }
  if (row.elapsed_ms >= durationMs) { clearInterval(monitor); finish("duration_reached"); }
}, monitorMs);

process.on("SIGINT", function () { clearInterval(monitor); finish("sigint"); });
process.on("SIGTERM", function () { clearInterval(monitor); finish("sigterm"); });

startChild();
snapshot();
log({ event: "campaign_start", dir: dir, target_minutes: minutes, metrics_path: metricsPath });
