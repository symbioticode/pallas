#!/usr/bin/env node
/**
 * PALLAS-M28 - rotation de credentials Polymarket REPRODUCTIBLE, sans secret reel.
 *
 * Ce script :
 *   1. genere des credentials de TEST a la volee (randomBytes) - JAMAIS de valeur reelle ;
 *   2. chiffre un vault v2 avec une passphrase generee ;
 *   3. fait la ROTATION : re-chiffre avec une NOUVELLE passphrase ;
 *   4. verifie que la nouvelle passphrase ouvre le nouveau vault et que l ANCIENNE
 *      ne l ouvre plus ;
 *   5. ecrit les vaults en 0600 et verifie les permissions ;
 *   6. (optionnel) si un testnet CLOB est accessible - PALLAS_ROTATION_LIVE=1 et
 *      PALLAS_ROTATION_BASE_URL - tente une derivation REELLE et rapporte la
 *      reponse exacte ; sinon rapporte "skipped" SANS presenter de simulation
 *      comme une execution reelle.
 *
 * Les valeurs de secrets ne sont JAMAIS imprimees : seules des empreintes
 * (SHA-256 tronque) le sont.
 *
 * Env :
 *   PALLAS_ROTATION_DIR      repertoire de sortie (defaut: tmpdir)
 *   PALLAS_ROTATION_LIVE     "1" pour tenter la derivation reseau reelle
 *   PALLAS_ROTATION_BASE_URL base CLOB (testnet si disponible)
 *   PALLAS_TESTNET_PRIVKEY   cle privee JETABLE de testnet (jamais financee)
 */
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptPolymarketSecrets, encryptPolymarketSecrets, PolymarketClient } from "@pallas/execution";

const out = {};
const dir = process.env.PALLAS_ROTATION_DIR || mkdtempSync(join(tmpdir(), "pallas-rotation-"));
mkdirSync(dir, { recursive: true });
const hex = (n) => randomBytes(n).toString("hex");
const fp = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 12);

const oldPass = hex(32);
const newPass = hex(32);
const testSecrets = { apiKey: "test-api-" + hex(6), apiSecret: hex(24), walletPrivateKey: "0x" + hex(32) };

// 1. vault initial (passphrase A)
const vaultA = encryptPolymarketSecrets(oldPass, testSecrets);
const pathA = join(dir, "vault-A.enc");
writeFileSync(pathA, vaultA + "\n", { mode: 0o600 });

// 2. dechiffrement de controle
const recovered = decryptPolymarketSecrets(oldPass, vaultA);

// 3. ROTATION : re-chiffrement avec la passphrase B
const vaultB = encryptPolymarketSecrets(newPass, recovered);
const pathB = join(dir, "vault-B.enc");
writeFileSync(pathB, vaultB + "\n", { mode: 0o600 });
chmodSync(pathB, 0o600);

// 4. verifications
const viaNew = decryptPolymarketSecrets(newPass, vaultB);
let oldPassRejected = false;
try { decryptPolymarketSecrets(oldPass, vaultB); } catch { oldPassRejected = true; }
const sameSecrets = JSON.stringify(viaNew) === JSON.stringify(testSecrets);
const modeA = statSync(pathA).mode & 0o777;
const modeB = statSync(pathB).mode & 0o777;

out.event = "rotation_result";
out.dir = dir;
out.generated = { kind: "TEST_ONLY", apiKey_fp: fp(testSecrets.apiKey), wallet_fp: fp(testSecrets.walletPrivateKey) };
out.rotation = { old_pass_rejected_on_new_vault: oldPassRejected, secrets_preserved: sameSecrets, vault_a_mode: modeA.toString(8), vault_b_mode: modeB.toString(8) };
out.files = { vault_a: pathA, vault_b: pathB };

// 5. reseau : testnet seulement, jamais mainnet avec de vraies cles
if (process.env.PALLAS_ROTATION_LIVE === "1" && process.env.PALLAS_ROTATION_BASE_URL && process.env.PALLAS_TESTNET_PRIVKEY) {
  try {
    const client = new PolymarketClient({ baseUrl: process.env.PALLAS_ROTATION_BASE_URL, isDryRun: () => false });
    const derived = await client.deriveApiKey(process.env.PALLAS_TESTNET_PRIVKEY, 0n);
    out.network = { status: "real_executed", base_url: process.env.PALLAS_ROTATION_BASE_URL, derived_api_key_fp: fp(derived.apiKey), note: "DERIVATION REELLE testnet - aucune valeur imprimee" };
  } catch (err) {
    out.network = { status: "real_attempt_failed", error: String(err && err.message ? err.message : err) };
  }
} else {
  out.network = { status: "skipped", reason: "aucun testnet CLOB Polymarket accessible (PALLAS_ROTATION_BASE_URL absent) - rien n est presente comme une execution reelle" };
}

console.log(JSON.stringify(out, null, 2));
