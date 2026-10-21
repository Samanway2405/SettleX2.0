# SettleX Pool Contract

This contract maintains administrator-approved accounting credits for SettleX.
It does not custody XLM, USDC, or another SAC asset.

## SX-179 invariant

Only `PoolConfig.admin` may call `deposit(member, amount)`. A member's
authorization alone must never increase their stored balance. The Rust suite
includes both sides of the invariant:

- `test_member_cannot_self_credit_without_admin_approval`
- `test_admin_can_allocate_credit_without_member_signature`

Run the contract tests from `contract/`:

```bash
cargo test -p settlement-pool-contract
```

Pool schema v1 is vulnerable and must be upgraded/migrated or replaced before
operational use. See [the pool security model](../../../docs/POOL_SECURITY_MODEL.md)
and [allocation runbook](../../../docs/POOL_ALLOCATION_RUNBOOK.md).
