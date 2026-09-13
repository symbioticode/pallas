#!/usr/bin/env node
/**
 * PALLAS-M27 - campagne d'observation 72h, ledger SUPERVISE signe toutes les 6h.
 *
 * Ce lanceur orchestre, pour la campagne cible (duree, incidents, token) :
 *   1. generation des cles de signature (operateur, hors process) si absentes ;
 *   2. bootstrapping du ledger (1 entree de graine) + checkpoint initial signe,
 *      VERIFIE par un re-chargement en mode supervise avant tout lancement ;
 *   3. attente jusqu'au prochain minuit local si PALLAS_START_AT=midnight ;
 *   4. lancement du superviseur observations (dry-run STRICT, SIGKILL a ~40%) ;
 *   5. re-signature de la tete de chaine + documentation toutes les 6h
 *      (checkpoints.jsonl machine + CHECKPOINTS.md lisible) ;
 *   6. au terme (summary.json) : checkpoint final + marqueur COMPLETE.
 *
 * La cle privee ne quitte jamais ~/.pallas-signing (0600) et sert UNIQUEMENT a
 * signer ; le process supervise ne la connait pas (garde exige par l'audit v0.5).
 *
 * Env :
 *   PALLAS_REF_TOKEN_ID        (requis) token(s) CLOB, separes par virgules
 *   PALLAS_CAMPAIGN_MINUTES     duree cible (defaut 4320 = 72h)
 *   PALLAS_CAMPAIGN_INTERVAL_MS pause inter-cycles (defaut 30000)
 *   PALLAS_CAMPAIGN_MONITOR_MS  periode de mesure superviseur (defaut 30000)
 *   PALLAS_CAMPAIGN_INCIDENT    "1" => SIGKILL a ~40% puis relance (defaut 1)
 *   PALLAS_START_AT             "now" (test) | "midnight" (defaut, se met a l'heure)
 *   PALLAS_SIGNING_DIR          dossier des cles (defaut ~/.pallas-signing)
 *   PALLAS_CHECKPOINT_EVERY_MS  cadence de signature (defaut 6h)
 *   PALLAS_CAMPAIGN_DIR         repertoire de campagne (auto si absent)
 *   PALLAS_CHECKPOINT_DOC       doc markdown alimentee (defaut docs/observation/...)
 */
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SUPERVISOR = join(REPO, 'scripts', 'observation-campaign.mjs');

const { FileLedger, ledgerCheckpointPath } = await import('../packages/ledger/dist/file-ledger.js');
const { generateLedgerSigningKeyPair, signLedgerCheckpoint } = await import('../packages/ledger/dist/ledger-signing.js');
const { atomicWriteFileSafe } = await import('../packages/core/dist/index.js');

function log(obj) { console.log(JSON.stringify(obj)); }
function nowIso() { return new Date().toISOString(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tokenRaw = process.env.PALLAS_REF_TOKEN_ID || '';
if (!tokenRaw) {
  log({ event: 'fatal', reason: 'PALLAS_REF_TOKEN_ID requis' });
  process.exit(2);
}
const minutes = Number(process.env.PALLAS_CAMPAIGN_MINUTES || '4320');
const intervalMs = Number(process.env.PALLAS_CAMPAIGN_INTERVAL_MS || '30000');
const monitorMs = Number(process.env.PALLAS_CAMPAIGN_MONITOR_MS || '30000');
const incident = (process.env.PALLAS_CAMPAIGN_INCIDENT || '1') === '1';
const startAt = process.env.PALLAS_START_AT || 'midnight';
const everyMs = Number(process.env.PALLAS_CHECKPOINT_EVERY_MS || (6 * 60 * 60 * 1000));
const signingDir = resolve(process.env.PALLAS_SIGNING_DIR || join(homedir(), '.pallas-signing'));
const checkpointDoc = resolve(
  process.env.PALLAS_CHECKPOINT_DOC || join(REPO, 'docs', 'observation', 'M27-72h-2026-09-13', 'CHECKPOINTS.md'),
);

function waitUntilMidnight(now = new Date()) {
  const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const ms = mid.getTime() - now.getTime();
  return ms > 0 ? ms : ms + 24 * 60 * 60 * 1000;
}

log({ event: 'wrapper_start', token: tokenRaw, minutes, interval_ms: intervalMs, monitor_ms: monitorMs, incident, start_at: startAt, every_ms: everyMs, repo: REPO });

mkdirSync(signingDir, { recursive: true });
const privPath = join(signingDir, 'ledger-signing.pem');
const pubPath = join(signingDir, 'ledger-signing.pub.pem');
if (!existsSync(privPath) || !existsSync(pubPath)) {
  const pair = generateLedgerSigningKeyPair();
  writeFileSync(privPath, pair.privateKeyPem, { flag: 'wx' });
  writeFileSync(pubPath, pair.publicKeyPem, { flag: 'wx' });
  chmodSync(privPath, 0o600);
  chmodSync(pubPath, 0o644);
  log({ event: 'keys_generated', priv: privPath, pub: pubPath });
}
const privPem = readFileSync(privPath, 'utf8');
const pubPem = readFileSync(pubPath, 'utf8');

const campaignTag = new Date().toISOString().replace(/[:.]/g, '-');
const dir = resolve(process.env.PALLAS_CAMPAIGN_DIR || join('.pallas', 'campaign-m27-72h-' + campaignTag));
const dot = join(dir, '.pallas');
const ledgerPath = join(dot, 'ledger.json');
const checkpointPath = ledgerCheckpointPath(ledgerPath);
mkdirSync(dot, { recursive: true });
mkdirSync(join(dir, 'logs'), { recursive: true });
if (existsSync(ledgerPath)) {
  log({ event: 'fatal', reason: 'ledger deja present en destination — campagne active ?', ledger: ledgerPath });
  process.exit(2);
}

log({ event: 'campaign_dir', dir, ledger: ledgerPath });

if (startAt === 'midnight') {
  const waitMs = waitUntilMidnight();
  const at = new Date(Date.now() + waitMs).toISOString();
  log({ event: 'delaying_until_midnight', wait_ms: waitMs, resume_at_iso: at });
  await sleep(waitMs);
  log({ event: 'delay_elapsed', at: nowIso() });
} else if (startAt === 'now') {
  log({ event: 'start_now', at: nowIso() });
} else {
  log({ event: 'fatal', reason: 'PALLAS_START_AT inconnu', value: startAt });
  process.exit(2);
}

const boot = FileLedger.load(ledgerPath, { mode: 'dev' });
await boot.append({
  event: 'campaign_seed',
  timestamp: nowIso(),
  payload: { note: 'M27 72h seed — cycle supervise debute', campaign: dir, tokens: tokenRaw },
});
const chain = FileLedger.load(ledgerPath, { mode: 'dev' }).entries;
const checkpoint = signLedgerCheckpoint(privPem, chain);
atomicWriteFileSafe(checkpointPath, JSON.stringify(checkpoint));
let verified = false;
let verifyError = null;
try {
  const probe = FileLedger.load(ledgerPath, { mode: 'dev', publicKeyPem: pubPem });
  verified = probe.isSigned;
} catch (err) {
  verifyError = err instanceof Error ? err.message : String(err);
  verified = false;
}
if (!verified) {
  log({ event: 'fatal', reason: 're-verification supervise du seed ECHOUEE', error: verifyError, ledger: ledgerPath });
  process.exit(2);
}
log({ event: 'seed_ok', head_index: checkpoint.head_index, head_hash: checkpoint.head_hash, signature_len: checkpoint.signature.length, verified });

let checkpointNumber = 0;
const checkpointJsonl = join(dir, 'checkpoints.jsonl');

function docRow(cp, state) {
  return [
    `| ${checkpointNumber} | ${cp.timestamp} | ${cp.head_index} | ${cp.head_event} | ${cp.head_hash.slice(0, 16)}… | ${state} |`,
  ];
}

async function writeCheckpoint(state, at = new Date()) {
  checkpointNumber += 1;
  const chainNow = FileLedger.load(ledgerPath, { mode: 'dev' }).entries;
  const cp = signLedgerCheckpoint(privPem, chainNow);
  atomicWriteFileSafe(checkpointPath, JSON.stringify(cp));
  let selfVerified = false;
  try {
    selfVerified = FileLedger.load(ledgerPath, { mode: 'dev', publicKeyPem: pubPem }).isSigned;
  } catch {
    selfVerified = false;
  }
  const rec = {
    index: checkpointNumber,
    at: at.toISOString(),
    head_index: cp.head_index,
    head_hash: cp.head_hash,
    head_event: cp.head_event,
    head_timestamp: cp.head_timestamp,
    signature_len: cp.signature.length,
    verified_load: selfVerified,
    state,
    ledger_entries: chainNow.length,
  };
  appendFileSync(checkpointJsonl, JSON.stringify(rec) + '\n');
  mkdirSync(resolve(checkpointDoc, '..'), { recursive: true });
  if (!existsSync(checkpointDoc)) {
    writeFileSync(
      checkpointDoc,
      [
        '# PALLAS-M27 — Checkpoints de campagne 72h (supervise)',
        '',
        'Re-signature manuelle de la tete de chaine par l\'operateur (cle hors process),',
        'toutes les 6h, avec re-verification en chargement type supervise.',
        '',
        'Campagne active : `' + dir + '`.',
        '',
        '| # | t (UTC) | head_index | head_event | head_hash | état |',
        '|---|---------|-----------|-----------|----------|------|',
      ].join('\n') + '\n',
    );
  }
  appendFileSync(checkpointDoc, docRow(cp, selfVerified ? 'verifie' : 'ECHEC verif') .join('\n') + '\n');
  log({ event: 'checkpoint_signed', number: checkpointNumber, state, head_index: cp.head_index, verified_load: selfVerified });
}

await writeCheckpoint('initial_seed');

const summaryPath = join(dir, 'summary.json');

const supervisorEnv = {
  ...process.env,
  PALLAS_REF_TOKEN_ID: tokenRaw,
  PALLAS_CAMPAIGN_DIR: dir,
  PALLAS_CAMPAIGN_MINUTES: String(minutes),
  PALLAS_CAMPAIGN_INTERVAL_MS: String(intervalMs),
  PALLAS_CAMPAIGN_MONITOR_MS: String(monitorMs),
  PALLAS_CAMPAIGN_INCIDENT: incident ? '1' : '0',
  PALLAS_LEDGER_MODE: 'supervised',
  PALLAS_LEDGER_PUB_KEY: pubPath,
};

const supervisor = spawn(process.execPath, [SUPERVISOR], { env: supervisorEnv, stdio: ['ignore', 'inherit', 'inherit'] });
log({ event: 'supervisor_launched', pid: supervisor.pid, dir });

let finalized = false;
function finalize(reason) {
  if (finalized) return;
  finalized = true;
  writeCheckpoint('final_' + reason, new Date()).then(() => {
    writeFileSync(join(dir, 'COMPLETE'), JSON.stringify({ reason, at: nowIso(), checkpoints: checkpointNumber }) + '\n');
    log({ event: 'campaign_complete', reason, checkpoints: checkpointNumber, dir, doc: checkpointDoc });
    setTimeout(() => process.exit(0), 300);
  });
}

process.on('SIGTERM', () => finalize('sigterm'));
process.on('SIGINT', () => finalize('sigint'));

const sinceCheckpoint = { at: Date.now() };
while (true) {
  if (existsSync(summaryPath)) {
    finalize('duration_reached');
    break;
  }
  if (supervisor.exitCode !== null && !existsSync(summaryPath)) {
    log({ event: 'supervisor_exited_without_summary', code: supervisor.exitCode, dir });
    finalize('supervisor_exited');
    break;
  }
  if (Date.now() - sinceCheckpoint.at >= everyMs) {
    sinceCheckpoint.at = Date.now();
    await writeCheckpoint('scheduled');
  }
  await sleep(30_000);
}