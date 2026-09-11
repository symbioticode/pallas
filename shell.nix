# Dev shell Nix pour Pallas — source de vérité du dev LOCAL et de la CI.
# Fournit Node 22, la toolchain Rust + linker C (gcc), clippy (lints),
# bubblewrap (sandbox d'isolation réseau) et cargo-audit (scan RustSec).
# Clippy ajouté au 2026-09-10 (PALLAS-M11) : dette d'outillage signalée par
# l'audit v0.1 et toujours absente à v0.2. cargo clippy tourne via ce shell :
#   nix-shell --run "cd crates/risk-engine && cargo clippy --all-targets --all-features -- -D warnings"
#
# nixpkgs est ÉPINGLÉ à une révision git fixe : le même environnement est
# reproductible hors du NixOS de dev (runner CI) — see mission-PALLAS-M06,
# annexe « vérification réelle sur runner ». fetchGit est content-addressed par
# le commit (verrou STABLE), contrairement à l'archive Web de GitHub qui est
# ré-rendue à la volée (hash instable, constaté en validation 2026-09-10).
#
# Usage : nix-shell  (défaut) — surcharge possible : nix-shell --arg pkgs '...'

{ pkgs ? import (builtins.fetchGit {
    url = "https://github.com/NixOS/nixpkgs";
    ref = "refs/heads/master";
    rev = "db62aa7ff983aba791a1760d35a102b72248229f";
    shallow = true;
  }) {}
}:

pkgs.mkShell {
  name = "pallas-dev";

  buildInputs = with pkgs; [
    nodejs_22
    rustc
    cargo
    clippy
    gcc
    binutils
    pkg-config
    bubblewrap
    cargo-audit
    git
  ];

  shellHook = ''
    echo "╔══════════════════════════════════════╗"
    echo "  Pallas dev shell (Nix)"
    echo "╚══════════════════════════════════════╝"
    echo "  Node:  $(node --version)"
    echo "  Rust:  $(cargo --version) / $(rustc --version)"
    echo "  bwrap: $(command -v bwrap >/dev/null 2>&1 && bwrap --version 2>/dev/null | head -1 || echo 'introuvable')"
    echo ""
    echo "  Commandes :"
    echo "    cargo test            → tests du risk engine"
    echo "    cargo clippy          → lints (avec -- -D warnings)"
    echo "    cargo audit           → scan dépendances RustSec"
    echo "    cargo build --release → binaire risk-engine"
    echo "    npm ci && npm test"
  '';
}