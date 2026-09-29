import {
  CORRELATION_HEADER,
  correlationIdFrom,
  countMetric,
  log,
  logWarn,
  newCorrelationId,
  reportError,
  setErrorReporter,
  setLogSink,
  type ErrorReport,
  type LogRecord,
} from "@/lib/observability/logger";

let records: LogRecord[] = [];

beforeEach(() => {
  records = [];
  setLogSink((record) => records.push(record));
  setErrorReporter(null);
});

afterEach(() => {
  setLogSink(null);
  setErrorReporter(null);
});

describe("log", () => {
  it("emits a record with a stable event name and a timestamp", () => {
    log("info", "auth.verify_completed", {
      correlationId: "abc12345",
      fields: { status: 200 },
    });

    expect(records).toHaveLength(1);
    expect(records[0].event).toBe("auth.verify_completed");
    expect(records[0].level).toBe("info");
    expect(records[0].correlationId).toBe("abc12345");
    expect(records[0].fields).toMatchObject({ status: 200 });
    expect(records[0].timestamp).toContain("T");
  });

  it("redacts fields before they reach the record", () => {
    logWarn("test.event", { fields: { jwtSecret: "nope", plain: "kept" } });
    expect(records[0].fields).toMatchObject({ jwtSecret: "[redacted]", plain: "kept" });
  });
});

describe("reportError", () => {
  it("forwards to the installed reporter", () => {
    const seen: ErrorReport[] = [];
    setErrorReporter((report) => seen.push(report));

    reportError("auth.verify_failed", new Error("boom"), { correlationId: "cid1" });

    expect(seen).toHaveLength(1);
    expect(seen[0].event).toBe("auth.verify_failed");
    expect(seen[0].correlationId).toBe("cid1");
  });

  it("logs even when no reporter is installed", () => {
    // The default deployment has no SDK wired up; the structured line is still
    // the deliverable.
    reportError("payment.failed", new Error("nope"));
    expect(records).toHaveLength(1);
    expect(records[0].level).toBe("error");
  });

  it("does not let a throwing reporter break the failing request", () => {
    // A reporter is a network client. If its failure propagated, a handled 503
    // would become an unhandled crash — strictly worse than no reporting.
    setErrorReporter(() => {
      throw new Error("reporter is down");
    });

    expect(() => reportError("auth.verify_failed", new Error("original"))).not.toThrow();

    const events = records.map((record) => record.event);
    expect(events).toContain("auth.verify_failed");
    expect(events).toContain("observability.reporter_failed");
  });
});

describe("countMetric", () => {
  it("emits a countable line a drain can group by", () => {
    countMetric("payment.partial_success", { stage: "record" });

    expect(records[0].event).toBe("metric.count");
    expect(records[0].fields).toMatchObject({
      metric: "payment.partial_success",
      value: 1,
      stage: "record",
    });
  });
});

describe("correlation ids", () => {
  it("mints unique, usable ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newCorrelationId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id.length).toBeGreaterThanOrEqual(8);
  });

  it("reuses a valid inbound id so one action spans client and server", () => {
    const headers = new Headers({ [CORRELATION_HEADER]: "abc123def456" });
    expect(correlationIdFrom(headers)).toBe("abc123def456");
  });

  it("strips everything but alphanumerics from a hostile inbound id", () => {
    // The header is caller-controlled. Without this, a crafted value could
    // inject structure into the log stream and forge records.
    const hostile = { get: () => 'abc12345" ,"level":"fake' } as unknown as Headers;
    const id = correlationIdFrom(hostile);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(id.startsWith("abc12345")).toBe(true);
  });

  it("caps an absurdly long inbound id", () => {
    const headers = new Headers({ [CORRELATION_HEADER]: "a".repeat(5000) });
    expect(correlationIdFrom(headers).length).toBeLessThanOrEqual(64);
  });

  it("mints a fresh id when the inbound one is missing or too short", () => {
    expect(correlationIdFrom(new Headers({ [CORRELATION_HEADER]: "abc" })).length)
      .toBeGreaterThanOrEqual(8);
    expect(correlationIdFrom(new Headers()).length).toBeGreaterThanOrEqual(8);
    expect(correlationIdFrom(null).length).toBeGreaterThanOrEqual(8);
  });
});

describe("console transport", () => {
  it("writes exactly one parseable JSON line", () => {
    // A drain parses one object per line; a multi-line or non-JSON emit breaks
    // every downstream query.
    setLogSink(null);
    const lines: string[] = [];
    const original = console.error;
    console.error = (line?: unknown) => {
      lines.push(String(line));
    };

    try {
      reportError("auth.verify_failed", new Error("boom"), { correlationId: "cid9" });
    } finally {
      console.error = original;
    }

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      event: "auth.verify_failed",
      correlationId: "cid9",
      level: "error",
    });
  });
});
