import withSerwistInit from "@serwist/next";

/**
 * CSP for static assets only — the paths `middleware.ts` deliberately skips.
 *
 * A stylesheet or image is not a document, so it needs no nonce and nothing it
 * could load: `'none'` across the board means a mistyped or user-uploaded file
 * served from this origin cannot execute anything. `frame-ancestors 'none'`
 * matches the enforcing policy so the two never disagree.
 */
const STATIC_ASSET_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ── Images ────────────────────────────────────────────────────────────────
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "stellar.expert" },
      { protocol: "https", hostname: "**.stellar.org" },
    ],
  },

  // ── Production security headers ───────────────────────────────────────────
  //
  // The Content-Security-Policy lives in `middleware.ts`, not here: it carries a
  // per-request nonce, which a static header cannot. Nothing in this block may
  // restate or relax it.
  //
  // There used to be a `Content-Security-Policy-Report-Only` header here with a
  // much weaker policy (`'unsafe-inline' 'unsafe-eval'`, `connect-src https:`)
  // and no `report-uri`/`report-to`, so it reported nowhere. It has been removed
  // rather than pointed at an endpoint: two policies on one response is how
  // someone ends up "fixing" a violation by relaxing the wrong one, and a
  // permissive-looking header misleads any scanner reading the response.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            // DENY, not SAMEORIGIN, to agree with `frame-ancestors 'none'` in
            // the enforcing policy. The two are read by different browser
            // generations, so disagreeing between them means the weaker answer
            // wins somewhere.
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      // `middleware.ts` skips static assets and the image optimizer (see its
      // `matcher`), so those responses would otherwise carry no CSP at all once
      // the report-only header is gone. The two rules below cover exactly the
      // paths that matcher excludes — and only those, so no response ever
      // receives two policies. Keep them in step with the matcher: a path the
      // middleware *does* handle must never appear here.
      //
      // Note what is deliberately absent: `/sw.js` and root-level fonts are NOT
      // matched, because the middleware does handle them. The service worker in
      // particular is a real script, and `script-src 'none'` would break the PWA.
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Content-Security-Policy", value: STATIC_ASSET_CSP }],
      },
      {
        // Image/media files at any path, plus the manifest. Extensions mirror
        // the matcher's own list.
        source: "/:path*.:ext(png|svg|jpg|jpeg|gif|webp|ico|webmanifest)",
        headers: [{ key: "Content-Security-Policy", value: STATIC_ASSET_CSP }],
      },
    ];
  },

  // ── Startup checks ────────────────────────────────────────────────────────
  // Enables instrumentation.ts, which fails a misconfigured production boot
  // rather than letting it come up healthy and break on the first sign-in.
  experimental: {
    instrumentationHook: true,
  },

  // ── Compiler options ──────────────────────────────────────────────────────
  compiler: {
    // Remove console.log in production
    removeConsole: process.env.NODE_ENV === "production"
      ? { exclude: ["error", "warn"] }
      : false,
  },

  // ── Optional: enable standalone output for Docker / self-hosting ─────────
  // output: "standalone",
};

// ── PWA (Serwist) ───────────────────────────────────────────────────────────
// Builds the service worker from app/sw.ts → public/sw.js. We register it
// manually (see components/pwa/ServiceWorkerRegister) so no inline script is
// injected, keeping the strict CSP intact. Disabled in dev for fast HMR.
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  register: false,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist(nextConfig);
