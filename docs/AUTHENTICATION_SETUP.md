# Wallet Authentication

SettleX uses a Stellar wallet as the user's identity. A wallet signs a
server-issued challenge, and the server verifies the signature before issuing a
Supabase JWT with a `wallet_address` claim. Database RLS policies authorize
requests from that verified claim.

## Session handling

- `/api/auth/verify` sets the JWT in an `HttpOnly`, `SameSite=Lax` cookie. In
  production it uses the `__Host-` cookie prefix with `Secure` and `Path=/`.
  The verify response does not include the JWT in JSON.
- The browser does not put the JWT in `localStorage` or expose it to the
  Supabase client. It retains only the wallet address and expiry in memory for
  UI state.
- Supabase REST requests go through same-origin `/api/supabase/rest/v1/*`
  handlers. The server validates the cookie before forwarding the request to
  PostgREST with the JWT.
- A valid cookie survives reloads. The browser can check its wallet and expiry
  through `/api/auth/session` without receiving the token.
- The session lasts one hour by default and can be configured with
  `AUTH_SESSION_TTL_SECONDS` up to the 12-hour cap. Renewing it requires a new
  wallet signature; the UI prompts before expiry.
- Since Supabase Realtime WebSockets need a JWT in browser JavaScript, expense
  and trip changes are polled every five seconds while a page is visible
  instead. This is less immediate than Realtime but keeps the bearer token
  private. HttpOnly prevents token extraction, not authenticated actions from
  an active XSS running in the page.
- Profile and offline app data may still be cached in `localStorage`; the
  session JWT is not.

## Server configuration

Set these server-only environment variables; never prefix them with
`NEXT_PUBLIC_`:

- `SUPABASE_JWT_SECRET` — signs the access token RLS authorizes on.
- `AUTH_CHALLENGE_SECRET` — binds a challenge to its wallet. Required in
  production and distinct from `SUPABASE_JWT_SECRET`.
- `AUTH_SESSION_TTL_SECONDS` — optional session lifetime in seconds, default
  3600, capped at 43200.
- `SUPABASE_SERVICE_ROLE_KEY` — backs the shared challenge replay guard,
  rate limiter, and server-side token revocation.

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as well.
Load the current schema and RLS policies from
[`supabase-setup.sql`](../supabase-setup.sql).
