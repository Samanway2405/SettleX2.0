# Pool Allocation Runbook

Use this procedure after deploying the pool contract and whenever allocating a
member credit. It applies to the accounting pool in this repository, not to a
token vault.

## Pre-flight

1. Verify the pool's `get_config()` output contains the expected administrator
   and settlement-contract addresses.
2. Verify the deployed WASM artifact and release record are pool schema version
   `2` or a later approved version. Never use the historical v1 testnet
   deployment.
3. Record the member address, approved amount, business reason, approver, and
   expected balance after allocation.

## Allocate

1. Submit `deposit(member, amount)` using only the configured pool admin.
2. Wait for finality and record the transaction hash in the allocation record.
3. Query `balance_of(member)` and reconcile it with the expected balance.

## Negative authorization check

On each new deployment, perform this once in a non-production test account:

1. Submit the exact allocation call with only the member's authorization.
2. Confirm it fails.
3. Confirm `balance_of(member)` did not change.

Failure of this check is a release blocker because it indicates SX-179 has
regressed.

## Incident response

If a pool below schema v2 is found in use, stop allocating against it, notify
operators that balances may be untrusted, deploy or upgrade to the approved
schema, and reconcile any business records before resuming. Do not silently
copy the old pool ID into production configuration.
