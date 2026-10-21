#!/usr/bin/env bash
# Build and deploy the separate settlement and pool Soroban contracts to testnet.
# Usage: ./scripts/deploy-contract.sh <secret-key-or-stellar-cli-alias>

set -euo pipefail

ACCOUNT="${1:-}"
if [[ -z "$ACCOUNT" ]]; then
  echo "Usage: $0 <secret-key-or-stellar-cli-alias>"
  exit 1
fi

SETTLEMENT_WASM="contract/target/wasm32v1-none/release/settlex_contract.wasm"
POOL_WASM="contract/target/wasm32v1-none/release/settlement_pool_contract.wasm"

echo "Building settlement contract..."
stellar contract build \
  --manifest-path contract/Cargo.toml \
  --package settlex-contract \
  --optimize

echo "Building pool contract..."
stellar contract build \
  --manifest-path contract/Cargo.toml \
  --package settlement-pool-contract \
  --optimize

for wasm in "$SETTLEMENT_WASM" "$POOL_WASM"; do
  if [[ ! -f "$wasm" ]]; then
    echo "Expected WASM was not produced: $wasm" >&2
    exit 1
  fi
done

echo "Deploying settlement contract to testnet..."
SETTLEMENT_ID=$(stellar contract deploy \
  --wasm "$SETTLEMENT_WASM" \
  --source-account "$ACCOUNT" \
  --network testnet \
  --inclusion-fee 1000000)

echo "Deploying pool contract to testnet..."
POOL_ID=$(stellar contract deploy \
  --wasm "$POOL_WASM" \
  --source-account "$ACCOUNT" \
  --network testnet \
  --inclusion-fee 1000000)

echo ""
echo "Deployment successful. Initialize the pool with the settlement contract address."
echo "Settlement contract: $SETTLEMENT_ID"
echo "Pool contract:       $POOL_ID"
echo "Settlement explorer: https://stellar.expert/explorer/testnet/contract/$SETTLEMENT_ID"
echo "Pool explorer:       https://stellar.expert/explorer/testnet/contract/$POOL_ID"
echo "Set NEXT_PUBLIC_CONTRACT_ID=$SETTLEMENT_ID in your environment."
