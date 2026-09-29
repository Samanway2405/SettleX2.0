# Observability

Every failure path in the app used to end in `console.error`. `next.config.mjs`
strips `console.log` in production but keeps `error`/`warn`, so failures went to
a browser console nobody reads, or to a server log line no drain could query.
For an app moving money, that is the difference between noticing a problem in
minutes and hearing about it from users.

Everything now goes through `lib/observability/`.

## What you get

One JSON object per line, with a stable `event` name you can alert on:

```json
{"level":"error","event":"auth.verify_failed","correlationId":"9f2c1a7b3e8d4c05",
 "fields":{"route":"POST /api/auth/verify","walletAddress":"GABCDE…WXYZ",
 "error":{"name":"Error","message":"signature mismatch","stack":"…"}},
 "timestamp":"2026-09-26T09:20:14.270Z"}
```

`event` never embeds variable data, so `event:"auth.verify_failed"` counts
cleanly. Alert on the event name, group by `fields`.

## Writing a log line

```ts
import { logWarn, reportError, countMetric } from "@/lib/observability/logger";

reportError("payment.failed", err, { fields: { expenseId } }); // error + reporter
logWarn("contract.read_payments_failed", { fields: { tripId } }); // degraded, not broken
countMetric("payment.partial_success", { stage: "record" });      // countable
```

Use `reportError` in a `catch` block — it logs *and* forwards to the error
tracker. Use `logWarn` when the app degraded but kept working (a cache fallback,
an RPC read that failed). Never `console.error`.

In an API route, use the request logger instead so lines carry a correlation id:

```ts
const logger = requestLogger("POST /api/auth/verify", request);
logger.error("auth.verify_failed", err, { walletAddress });
logger.finish("auth.verify_completed", 500);
return jsonWithCorrelation(logger, { error: "…" }, { status: 500, headers: NO_STORE });
```

Call `finish` exactly once per response: it is the terminal line that records
status and duration, so every request has one countable outcome.

## Correlation ids

Each request gets an id, reused from the inbound `x-request-id` header if
present and minted otherwise, and returned on the response. A user reporting
"sign-in failed, reference abc123" points you straight at the server-side stack
trace — while the response body itself stays deliberately vague.

The inbound value is caller-controlled, so it is stripped to
`[A-Za-z0-9_-]{8,64}`. Without that, a crafted header could inject structure
into the log stream and forge records.

The client error boundaries show `error.digest` when React provides it (it ties
the browser to the server-rendered error) and fall back to a generated id.

## Redaction — read this before adding a field

`lib/observability/redact.ts` scrubs everything before it is emitted. A log drain
is a third party: it retains and indexes whatever it is sent, so a secret that
reaches it has leaked.

- Keys matching `secret|token|password|xdr|authorization|jwt|signature|…` become
  `[redacted]`.
- Wallet addresses are truncated to `GABCDE…WXYZ` — still enough to correlate one
  user's requests, not enough to resolve the account on a public ledger and tie
  it to an amount.
- JWTs, bearer tokens and loose Stellar addresses are scrubbed out of free text,
  including error messages and stack traces.
- Unknown class instances are reduced to `[object]` rather than serialised, since
  a client object can carry credentials on properties this code cannot anticipate.
- Supabase `details` is never forwarded: PostgREST puts the rejected row's values
  (amounts, addresses) there.

Redaction is automatic, but do not rely on it as a licence to pass secrets in.

## Wiring up an error tracker

No SDK ships as a dependency, so the default reporter is the structured log line
itself — which on Vercel and every comparable host is already collected,
searchable and alertable. Once per process it emits
`observability.no_error_provider` to say no tracker is attached.

To send errors to Sentry or anything else, edit **one function** —
`defaultReporter` in `lib/observability/init.ts`. All 30+ call sites go through
`reportError`, so nothing else changes:

```ts
// npm install @sentry/nextjs, then:
import * as Sentry from "@sentry/nextjs";

function defaultReporter(report: ErrorReport): void {
  Sentry.captureException(report.error ?? new Error(report.event), {
    tags: { event: report.event, correlationId: report.correlationId },
    extra: report.fields, // already redacted
  });
}
```

A reporter is a network client, so `reportError` calls it inside its own
try/catch: a broken reporter must never turn a handled 503 into a crash. It
logs `observability.reporter_failed` instead.

## What a user is allowed to see

`lib/errors/userMessage.ts` decides what an error boundary or toast may display.
`app/error.tsx` used to render `error.message` verbatim, and because the Supabase
paths re-throw raw PostgREST errors it could print

```
new row violates row-level security policy for table "expenses"
```

at a user — leaking the schema and the fact that RLS is the gate.

It is an **allowlist**, not a blanket hide. Much of the app throws text written
for people ("Lobstr extension is not installed.", "Pool balance is insufficient
for this transfer."), and replacing those with "something went wrong" would make
the product worse. A message is shown only when it reads like authored prose and
trips none of the internal markers — Postgres/PostgREST wording, stack frames,
JSON dumps, tokens, wallet addresses, protocol jargon such as `JWT`, framework
errors. Anything else becomes a generic line. **The safe default is to hide**, so
a newly added internal error is suppressed until someone deliberately makes it
user-facing.

```ts
import { userFacingMessage } from "@/lib/errors/userMessage";

const { message, wasSuppressed } = userFacingMessage(err);
```

Suppression changes only what is **displayed** — the full error always reaches
`reportError`, and `fields.messageSuppressed` records that a substitution
happened, so a message that *should* have been user-facing can be spotted and
reworded rather than silently swallowed.

Use it at every surface that renders error text: both boundaries, the payment
panel, settlement toasts, the wallet connect toast, and the trip page's degraded
banner. `app/global-error.tsx` goes further and never shows a message at all — a
crash that deep is always internal, so only the reference id is useful.

## Where it is installed

- **Server** — `instrumentation.ts`, before the boot-time config check, so a
  failed production boot is itself reported.
- **Client** — `components/observability/ObservabilityInit.tsx`, first in the
  provider tree in `app/layout.tsx`. It also catches `unhandledrejection` and
  window `error`, which React error boundaries never see — and most of this
  app's failure paths are async.
- **Boundaries** — `app/error.tsx` and `app/global-error.tsx`. The latter is new:
  `error.tsx` renders *inside* the root layout and so cannot catch a provider
  crash, which previously produced a blank page with nothing logged.

## Events worth alerting on

| Event | Why it matters |
|---|---|
| `auth.config_missing` | A secret is unset — **nobody can sign in**. Page immediately. |
| `auth.shared_store_unavailable` | Replay guard is down, so sign-in fails closed. |
| `auth.verify_rejected` | A spike means signing is broken, or someone is probing. |
| `auth.revocation_not_configured` | Sign-out cannot revoke; tokens stay live. |
| `boot.config_invalid` | Production boot refused to start. |
| `payment.onchain_record_failed` | **XLM moved but the contract has no record** — ledger and app disagree. |
| `expense.mark_share_paid_failed` | Payment settled on-chain but the database does not show it. |
| `*.rls_denied` (via `fields.kind`) | RLS rejected a write — auth or policy problem. |
| `auth.session_handshake_failed` | A wallet could not establish a session; users are stuck on cached data. |
| `auth.signup_failed` / `auth.signin_failed` | An unrecognised database failure blocked account creation or sign-in. |
| `trip.realtime_failed` / `expense.realtime_failed` | Lists silently stop updating. |
| `contract.fetch_events_failed` | Sustained = the Soroban RPC is down. |
| `observability.no_error_provider` | This deployment has no error tracker wired up. |

## Metrics

`countMetric` emits `event:"metric.count"` with `fields.metric` and
`fields.value`. Count by `fields.metric` in your drain.

Deliberately not an in-process counter: that would be per-instance and lost on
every scale-down.

The issue asked how often payments end in `partial_success`. That is
`payment.partial_success` (with `fields.stage` distinguishing the first attempt
from a retry), against `payment.success` as the denominator — a rate, not a raw
count. Also emitted: `payment.failed`, `payment.rejected_in_wallet` (a user
declining in their wallet is normal traffic, counted but not reported, so it
cannot drown real failures), `auth.session_issued`, `auth.session_revoked`.
