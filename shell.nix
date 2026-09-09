# Dev shell Nix pour Pallas.
# Fournit la toolchain Rust (cargo + rustc) ET le linker C (gcc) indispensable
# pour compiler les dépendances Rust. Inspiré de 53_TAXE_OPTIMIZER.
#
# Usage : nix develop  (ou nix-shell sur les systèmes sans flakes)

{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  name = "pallas-dev";

  buildInputs = with pkgs; [
    rustc
    cargo
    gcc
    binutils
    pkg-config
    git
  ];

  shellHook = ''
    echo "╔══════════════════════════════════════╗"
    echo "  Pallas dev shell (Nix)"
    echo "╚══════════════════════════════════════╝"
    echo "  Rust:  $(cargo --version) / $(rustc --version)"
    echo "  Node:  $(node --version)"
    echo ""
    echo "  Commandes :"
    echo "    cargo test            → tests du risk engine"
    echo "    cargo build --release → binaire risk-engine"
    echo "    npm install && npm test"
  '';
}
