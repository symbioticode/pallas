export * from './credentials.js';
// PALLAS-M17 : dry-run expose PUBLICEMENT seulement la surface sûre.
// `enableDryRun` (retour au mode simulation) est volontairement ABSENT du
// paquet : aucun chemin de décision (ordre/agent) ne doit pouvoir réarmer
// le dry-run. Il reste importable en interne (tests core) via './dry-run.js'.
export {
  isDryRun,
  getDryRunState,
  disableDryRun,
  type DryRunState,
  type DisableDryRunResult,
} from './dry-run.js';
export * from './sanitizer.js';
export * from './config.js';
export * from './atomicfs.js';
export * from './file-lock.js';
