import { NextRequest, NextResponse } from "next/server";

/**
 * Nonce-based Content-Security-Policy.
 *
 * A fresh nonce is generated per request and attached to Next.js's own inline
 * bootstrap scripts (Next reads the CSP from the request header and injects the
 * nonce automatically). `strict-dynamic` then lets those trusted scripts load
 * the rest of the bundle, so we never need `script-src 'unsafe-inline'` in
 * production — the single biggest XSS lever a money app must close.
 *
 * `style-src` still allows inline styles because Framer Motion and Tailwind
 * inject style attributes at runtime; there is no nonce path for those.
 *
 * This is the ONLY place a Content-Security-Policy is set for documents.
 * `next.config.mjs` used to also send a much weaker
 * `Content-Security-Policy-Report-Only` that reported nowhere; it has been
 * removed. If a violation needs fixing, fix it here — do not add a second
 * policy, and never relax one to satisfy the other. The one CSP that file still
 * sets covers static assets only (the paths this `matcher` skips), and is
 * strictly tighter than this policy.
 */
export function middleware(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const nonce = btoa(crypto.randomUUID());

  function getOrigin(url?: string): string | undefined {
    if (!url) return undefined;
    try {
      return new URL(url).origin;
    } catch {
      return undefined;
    }
  }

  const horizonOrigin = getOrigin(process.env.NEXT_PUBLIC_HORIZON_URL);
  const sorobanOrigin = getOrigin(process.env.NEXT_PUBLIC_SOROBAN_RPC_URL);
  const supabaseOrigin = getOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);

  // Network origins the app legitimately talks to.
  const connectSrc = [
    "'self'",
    horizonOrigin,
    sorobanOrigin,
    supabaseOrigin,
    supabaseOrigin ? supabaseOrigin.replace(/^http/, "ws") : undefined,
    "https://api.stellar.expert",
    "https://*.walletconnect.com",
    "https://*.walletconnect.org",
    "wss://*.walletconnect.com",
    "wss://*.walletconnect.org",
    "https://*.reown.com",
    "wss://*.reown.com",
    // Dev-only: Next.js HMR websocket + fast-refresh polling.
    ...(isDev ? ["ws://localhost:*", "http://localhost:*"] : []),
  ].filter(Boolean).join(" ");

  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' 'unsafe-inline'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https:`,
    `font-src 'self'`,
    `connect-src ${connectSrc}`,

    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // Paired with `X-Frame-Options: DENY` in next.config.mjs. Older browsers
    // read only the header, newer ones prefer this directive; if the two ever
    // disagree, the weaker answer wins on some client. Change both or neither.
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ]
    .join("; ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Run on all routes except static assets and image optimizer output.
     * `missing` skips prefetch/RSC requests so we don't pay the cost twice.
     */
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
