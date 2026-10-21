# Pool Security Model

## What the pool is

The SettleX pool is an operator-managed **accounting ledger**. A balance is an
authorization-controlled credit that the configured pool administrator has
allocated to a member. It is not an XLM balance, USDC balance, token claim, or
proof that a member paid an expense.

## Allocation rule

`deposit(member, amount)` is named for backwards compatibility, but it is an
allocation operation. It requires `PoolConfig.admin.require_auth()`. The member
does not authorize allocation and cannot create or replenish their own credit.

This is the SX-179 security boundary. A valid member signature by itself must
make the transaction fail without changing persistent balance storage.

## Consumption rule

`withdraw(from, amount)` requires both the configured settlement-contract
address and the member. It deducts an accounting allocation only; it does not
send an asset to any address. The pool is intentionally not presented as an
escrow, vault, or payment rail.

## Operator requirements

- Use pool schema version 2 or later. The historical v1 pool allowed
  member-authorized self-crediting and is unsafe.
- Give the administrator key least-privilege custody and audit every allocation
  off chain.
- Check the member balance before and after an operator allocation, and retain
  the transaction hash with the approval record.
- Do not market a pool credit as a deposit or a transferable token.

## Future custody model

If SettleX needs an economically backed pool, replace this ledger with a
Stellar Asset Contract integration that atomically transfers an explicit asset
into the contract and transfers it out on settlement. That is a separate design
and audit scope; an admin-only accounting credit is not a substitute for it.
