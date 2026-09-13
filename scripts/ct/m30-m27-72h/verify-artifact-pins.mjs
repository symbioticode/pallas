#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`argument requis: ${name}`);
  return args[index + 1];
};

try {
  const manifestPath = resolve(value('--manifest'));
  const root = resolve(value('--root'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const artifacts = Object.entries(manifest.artifacts ?? {});
  if (artifacts.length !== 8) {
    throw new Error(`manifeste invalide: 8 artefacts attendus, ${artifacts.length} trouves`);
  }

  let failures = 0;
  for (const [relativePath, expected] of artifacts) {
    const candidate = resolve(root, relativePath);
    if (isAbsolute(relativePath) || (candidate !== root && !candidate.startsWith(`${root}${sep}`))) {
      console.error(`ARTIFACT_PIN FAIL path=${relativePath} reason=path_outside_root`);
      failures += 1;
      continue;
    }
    try {
      if (!statSync(candidate).isFile()) throw new Error('not_a_file');
      const actual = createHash('sha256').update(readFileSync(candidate)).digest('hex');
      if (actual !== expected) {
        console.error(`ARTIFACT_PIN FAIL path=${relativePath} expected=${expected} actual=${actual}`);
        failures += 1;
      } else {
        console.log(`ARTIFACT_PIN PASS path=${relativePath} sha256=${actual}`);
      }
    } catch (error) {
      console.error(`ARTIFACT_PIN FAIL path=${relativePath} reason=${error.code ?? error.message}`);
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`ARTIFACT_PIN RESULT=REJECTED failures=${failures} checked=${artifacts.length}`);
    process.exit(1);
  }
  console.log(`ARTIFACT_PIN RESULT=PASS checked=${artifacts.length}`);
} catch (error) {
  console.error(`ARTIFACT_PIN RESULT=REJECTED reason=${error.message}`);
  process.exit(2);
}
