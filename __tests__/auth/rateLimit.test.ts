import { clientKey, rateLimit, resetRateLimits } from "@/lib/auth/rateLimit";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows calls up to the limit", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit("k", 3, 1000, 0).allowed).toBe(true);
    }
  });

  it("blocks the call past the limit and reports a retry delay", () => {
    for (let i = 0; i < 3; i += 1) rateLimit("k", 3, 10_000, 0);

    const blocked = rateLimit("k", 3, 10_000, 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBe(10);
  });

  it("starts a fresh window once the old one lapses", () => {
    for (let i = 0; i < 3; i += 1) rateLimit("k", 3, 1000, 0);
    expect(rateLimit("k", 3, 1000, 0).allowed).toBe(false);

    expect(rateLimit("k", 3, 1000, 1500).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 3; i += 1) rateLimit("a", 3, 1000, 0);

    expect(rateLimit("a", 3, 1000, 0).allowed).toBe(false);
    expect(rateLimit("b", 3, 1000, 0).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  const request = (headers: Record<string, string>, directIp?: string) =>
    ({
      ip: directIp,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    }) as unknown as Request;

  it("prefers platform-provided request.ip when available", () => {
    expect(clientKey(request({ "x-real-ip": "9.9.9.9" }, "198.51.100.1"))).toBe("198.51.100.1");
  });

  it("prefers x-real-ip over x-forwarded-for", () => {
    expect(
      clientKey(request({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4, 5.6.7.8" })),
    ).toBe("9.9.9.9");
  });

  it("uses the last trusted hop of x-forwarded-for when x-real-ip is absent", () => {
    expect(clientKey(request({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("5.6.7.8");
  });

  it("falls back to unknown when no client IP header is present", () => {
    expect(clientKey(request({}))).toBe("unknown");
  });

  it("does not reset the rate limit counter when X-Forwarded-For is changed (Issue #197)", () => {
    resetRateLimits();
    const limit = 3;
    const windowMs = 60_000;

    // Attacker rotates client-controlled X-Forwarded-For header, but edge proxy sets x-real-ip
    const req1 = request({ "x-real-ip": "203.0.113.197", "x-forwarded-for": "1.1.1.1" });
    const req2 = request({ "x-real-ip": "203.0.113.197", "x-forwarded-for": "2.2.2.2" });
    const req3 = request({ "x-real-ip": "203.0.113.197", "x-forwarded-for": "3.3.3.3" });
    const req4 = request({ "x-real-ip": "203.0.113.197", "x-forwarded-for": "4.4.4.4" });

    expect(rateLimit(clientKey(req1), limit, windowMs).allowed).toBe(true);
    expect(rateLimit(clientKey(req2), limit, windowMs).allowed).toBe(true);
    expect(rateLimit(clientKey(req3), limit, windowMs).allowed).toBe(true);
    // 4th request must be rate limited even though X-Forwarded-For was rotated each request
    expect(rateLimit(clientKey(req4), limit, windowMs).allowed).toBe(false);
  });

  it("does not reset the rate limit counter when prepended hops in X-Forwarded-For are rotated", () => {
    resetRateLimits();
    const limit = 3;
    const windowMs = 60_000;
    const realIp = "198.51.100.99";

    // Attacker prepends fake IPs to X-Forwarded-For, but trusted proxy appends true IP as last hop
    const req1 = request({ "x-forwarded-for": `10.1.1.1, ${realIp}` });
    const req2 = request({ "x-forwarded-for": `10.2.2.2, ${realIp}` });
    const req3 = request({ "x-forwarded-for": `10.3.3.3, ${realIp}` });
    const req4 = request({ "x-forwarded-for": `10.4.4.4, ${realIp}` });

    expect(rateLimit(clientKey(req1), limit, windowMs).allowed).toBe(true);
    expect(rateLimit(clientKey(req2), limit, windowMs).allowed).toBe(true);
    expect(rateLimit(clientKey(req3), limit, windowMs).allowed).toBe(true);
    expect(rateLimit(clientKey(req4), limit, windowMs).allowed).toBe(false);
  });
});

