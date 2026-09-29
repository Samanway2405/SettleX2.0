/**
 * The regression these tests exist for: every response carried two
 * Content-Security-Policy headers. `middleware.ts` sent a strong nonce +
 * `strict-dynamic` enforcing policy, while `next.config.mjs` also sent a
 * `Content-Security-Policy-Report-Only` that allowed `'unsafe-inline'`,
 * `'unsafe-eval'` and `connect-src https:` — and carried no `report-uri` or
 * `report-to`, so it reported nowhere.
 *
 * It collected nothing, made the response look permissive to any scanner, and
 * invited someone to "fix" a violation by relaxing the wrong policy. In the same
 * block, `X-Frame-Options: SAMEORIGIN` contradicted `frame-ancestors 'none'`.
 *
 * These read the two source files directly rather than booting Next: the bug was
 * a disagreement *between* the files, which is exactly what a unit test of either
 * one in isolation would miss.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const configSource = fs.readFileSync(path.join(root, "next.config.mjs"), "utf8");
const middlewareSource = fs.readFileSync(path.join(root, "middleware.ts"), "utf8");

/**
 * Drops comment lines so that prose *about* the old bug is not mistaken for the
 * bug itself — several comments here name the deleted header deliberately.
 *
 * Line-based on purpose: a regex for `/* … *\/` mis-pairs against the `//` in
 * the `https://` URLs inside these files' template literals, and would silently
 * delete most of the policy it is meant to be checking.
 */
function withoutComments(source: string): string {
  const lines = source.split("\n");
  const kept: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      continue;
    }
    // A block comment that opens a line (never mid-expression in these files).
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlock = true;
      continue;
    }
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;

    kept.push(line);
  }

  return kept.join("\n");
}

const config = withoutComments(configSource);
const middleware = withoutComments(middlewareSource);

describe("only one CSP governs a document", () => {
  it("next.config.mjs sends no report-only policy", () => {
    // A report-only header with nowhere to report is pure noise, and a second
    // policy is how the wrong one gets relaxed.
    expect(config).not.toContain("Content-Security-Policy-Report-Only");
  });

  it("the enforcing document policy lives only in middleware.ts", () => {
    expect(middleware).toContain('response.headers.set("Content-Security-Policy"');
  });

  it("next.config.mjs never sets a policy for document routes", () => {
    // It may set one for static assets (the paths middleware skips). What it must
    // not do is attach a CSP to the catch-all `/(.*)` group, which would land a
    // second policy on every page.
    const catchAll = config.slice(config.indexOf('source: "/(.*)"'));
    const nextGroup = catchAll.indexOf("source:", 1);
    const catchAllGroup = nextGroup === -1 ? catchAll : catchAll.slice(0, nextGroup);

    expect(catchAllGroup).not.toContain("Content-Security-Policy");
  });
});

describe("the two anti-framing controls agree", () => {
  it("X-Frame-Options is DENY, matching frame-ancestors 'none'", () => {
    // SAMEORIGIN vs 'none' is a real disagreement: different browser generations
    // read different controls, so the weaker answer wins somewhere.
    expect(config).toContain('value: "DENY"');
    expect(config).not.toContain("SAMEORIGIN");
  });

  it("the enforcing policy denies framing outright", () => {
    expect(middleware).toContain("frame-ancestors 'none'");
  });
});

describe("the enforcing policy keeps its teeth in production", () => {
  it("relies on a per-request nonce with strict-dynamic", () => {
    expect(middleware).toContain("'strict-dynamic'");
    expect(middleware).toMatch(/nonce-\$\{nonce\}/);
  });

  it("allows unsafe-inline and unsafe-eval for scripts only in development", () => {
    // The production branch of scriptSrc must carry neither; that was the whole
    // point of the nonce, and the deleted report-only header allowed both.
    const match = middleware.match(/const scriptSrc = isDev[\s\S]*?;\n/);
    expect(match).not.toBeNull();

    const [, productionBranch] = (match as RegExpMatchArray)[0].split(":");
    expect(productionBranch).not.toContain("unsafe-inline");
    expect(productionBranch).not.toContain("unsafe-eval");
  });

  it("does not widen connect-src to all of https:", () => {
    // The old report-only policy used a bare `https:`, which is no restriction
    // at all for a money app.
    expect(middleware).not.toMatch(/connect-src[^;`]*\bhttps:(?![/\w])/);
  });
});

describe("static assets still get a policy", () => {
  it("covers the paths the middleware matcher skips", () => {
    // Deleting the report-only header must not leave these bare.
    expect(config).toContain("STATIC_ASSET_CSP");
    expect(config).toContain("/_next/static/:path*");
  });

  it("is strictly tighter than the document policy, never weaker", () => {
    const declaration = configSource.slice(
      configSource.indexOf("const STATIC_ASSET_CSP"),
      configSource.indexOf("].join(\"; \")"),
    );

    expect(declaration).toContain("default-src 'none'");
    expect(declaration).toContain("script-src 'none'");
    expect(declaration).toContain("frame-ancestors 'none'");
    expect(declaration).not.toContain("unsafe-inline");
    expect(declaration).not.toContain("unsafe-eval");
  });

  it("does not claim /sw.js, which the middleware handles and must execute", () => {
    // script-src 'none' on the service worker would break the PWA.
    expect(config).not.toMatch(/source:\s*"\/sw\.js"/);
    // The asset rules match image/manifest extensions; `js` is not among them.
    const assetRule = config.match(/source:\s*"\/:path\*\.:ext\(([^)]*)\)"/);
    expect(assetRule).not.toBeNull();
    expect((assetRule as RegExpMatchArray)[1].split("|")).not.toContain("js");
  });
});
