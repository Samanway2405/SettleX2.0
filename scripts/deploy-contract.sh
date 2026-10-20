#!/usr/bin/env bash
# Deploy and initialize both SettleX contract instances.
#
# Prerequisites:
#   - Rust with the wasm32v1-none target
#   - Stellar CLI with constructor support
#   - A funded account (the account is also the immutable contract admin)
#
# Usage:
#   ./scripts/deploy-contract.sh <secret-key-or-alias> [network]
#
# The settlement constructor initializes its admin atomically. The pool
# constructor then initializes the pool atomically with the settlement address.
# The final set_pool_contract call wires the already-initialized contracts
# together; it is admin-authenticated and cannot be front-run.

set -euo pipefail

ACCOUNT="${1:-}"
NETWORK="${2:-testnet}"
INCLUSION_FEE="${INCLUSION_FEE:-1000000}"
# 1,000,000 stroops is an upper bound for inclusion, not a contract fee.

if [[ -z "$ACCOUNT" ]]; then
  echo "Usage: $0 <secret-key-or-stellar-cli-alias> [network]" >&2
  exit 1
fi

case "$NETWORK" in
  testnet|mainnet|futurenet|local)
    ;;
  *)
    echo "Unsupported network: $NETWORK" >&2
    exit 1
    ;;
esac

WASM_PATH="contract/target/wasm32v1-none/release/settlex_contract.wasm"
SETTLEMENT_SALT="534554544c455800000000000000000000000000000000000000000000000001"
POOL_SALT="534554544c45585000000000000000000000000000000000000000000000000001"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Building SettleX contracts for $NETWORK..."
stellar contract build \
  --manifest-path contract/Cargo.toml \
  --package settlex-contract \
  --optimize

echo "Deploying settlement contract with atomic constructor..."
stellar contract deploy \
    --wasm "$WASM_PATH" \
    --source-account "$ACCOUNT" \
    --network "$NETWORK" \
    --salt "$SETTLEMENT_SALT" \
    --inclusion-fee "$INCLUSION_FEE" \
    -- --admin "$ACCOUNT" 2>&1 | tee "$TMP_DIR/settlement-deploy.log"
SETTLEMENT_ID="$(grep -Eo 'C[A-Z2-7]{55}' "$TMP_DIR/settlement-deploy.log" | tail -n 1)"
SETTLEMENT_TX_HASH="$(grep -Eio '[a-f0-9]{64}' "$TMP_DIR/settlement-deploy.log" | tail -n 1 || true)"

if [[ ! "$SETTLEMENT_ID" =~ ^C[A-Z2-7]{55}$ ]]; then
  echo "Could not parse settlement contract ID: $SETTLEMENT_ID" >&2
  exit 1
fi

echo "Deploying pool contract with atomic constructor..."
stellar contract deploy \
    --wasm "$WASM_PATH" \
    --source-account "$ACCOUNT" \
    --network "$NETWORK" \
    --salt "$POOL_SALT" \
    --inclusion-fee "$INCLUSION_FEE" \
    -- --admin "$ACCOUNT" --settlement-contract "$SETTLEMENT_ID" \
    2>&1 | tee "$TMP_DIR/pool-deploy.log"
POOL_ID="$(grep -Eo 'C[A-Z2-7]{55}' "$TMP_DIR/pool-deploy.log" | tail -n 1)"
POOL_TX_HASH="$(grep -Eio '[a-f0-9]{64}' "$TMP_DIR/pool-deploy.log" | tail -n 1 || true)"

if [[ ! "$POOL_ID" =~ ^C[A-Z2-7]{55}$ ]]; then
  echo "Could not parse pool contract ID: $POOL_ID" >&2
  exit 1
fi

echo "Wiring settlement contract to initialized pool..."
SET_POOL_OUTPUT="$(
  stellar contract invoke \
    --id "$SETTLEMENT_ID" \
    --source-account "$ACCOUNT" \
    --network "$NETWORK" \
    --send yes \
    --inclusion-fee "$INCLUSION_FEE" \
    -- set-pool-contract --pool-contract "$POOL_ID"
)"

echo ""
echo "Deployment and initialization succeeded."
echo "Network: $NETWORK"
echo "Settlement contract: $SETTLEMENT_ID"
echo "Pool contract:       $POOL_ID"
echo "Settlement deployment transaction hash: ${SETTLEMENT_TX_HASH:-see output below}"
echo "Pool deployment transaction hash:       ${POOL_TX_HASH:-see output below}"
echo "Settlement deployment transaction:"
cat "$TMP_DIR/settlement-deploy.log"
echo "Pool deployment transaction:"
cat "$TMP_DIR/pool-deploy.log"
echo "set_pool_contract transaction output:"
echo "$SET_POOL_OUTPUT"
echo ""
echo "Set NEXT_PUBLIC_CONTRACT_ID=$SETTLEMENT_ID"
