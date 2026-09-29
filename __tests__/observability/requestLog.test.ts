import {
  CORRELATION_HEADER,
  setErrorReporter,
  setLogSink,
  type LogRecord,
} from "@/lib/observability/logger";
import { jsonWithCorrelation, requestLogger } from "@/lib/observability/requestLog";

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

function post(headers: Record<string, string> = {}): Request {
  return new Request("https://settlex.app/api/auth/verify", { method: "POST", headers });
}

describe("requestLogger", () => {
  it("tags every line from one request with the same id", () => {
    const logger = requestLogger("POST /api/auth/verify", post());

    logger.warn("auth.verify_rejected", { reason: "bad_signature" });
    logger.finish("auth.verify_completed", 401);

    expect(records).toHaveLength(2);
    expect(records[0].correlationId).toBe(logger.correlationId);
    expect(records[1].correlationId).toBe(logger.correlationId);
  });

  it("adopts an inbound correlation id so client and server lines join up", () => {
    const logger = requestLogger("POST /api/auth/verify", post({
      [CORRELATION_HEADER]: "inbound12345",
    }));
    expect(logger.correlationId).toBe("inbound12345");
  });

  it("records the route on every line", () => {
    const logger = requestLogger("POST /api/auth/verify", post());
    logger.info("auth.challenge_completed");
    expect(records[0].fields).toMatchObject({ route: "POST /api/auth/verify" });
  });

  it("records status and duration on finish", () => {
    const logger = requestLogger("POST /api/auth/verify", post());
    logger.finish("auth.verify_completed", 200, { reason: "ok" });

    expect(records[0].fields).toMatchObject({ status: 200, reason: "ok" });
    expect(typeof (records[0].fields as { durationMs?: unknown }).durationMs).toBe("number");
  });

  it("warns on a 5xx but stays info on a 4xx", () => {
    // A 4xx is the caller's problem and is high-volume; a 5xx is ours and is
    // what an alert should fire on.
    requestLogger("r", post()).finish("e", 500);
    requestLogger("r", post()).finish("e", 400);

    expect(records[0].level).toBe("warn");
    expect(records[1].level).toBe("info");
  });

  it("redacts a wallet address passed as a field", () => {
    const wallet = `GA${"B".repeat(54)}`;
    const logger = requestLogger("POST /api/auth/verify", post());
    logger.finish("auth.verify_completed", 200, { walletAddress: wallet });

    const fields = records[0].fields as { walletAddress?: string };
    expect(fields.walletAddress).not.toBe(wallet);
    expect(fields.walletAddress).toContain("…");
  });
});

describe("jsonWithCorrelation", () => {
  it("returns the correlation id to the caller so a user can quote it", () => {
    const logger = requestLogger("POST /api/auth/verify", post());
    const response = jsonWithCorrelation(logger, { error: "nope" }, { status: 503 });

    expect(response.status).toBe(503);
    expect(response.headers.get(CORRELATION_HEADER)).toBe(logger.correlationId);
  });

  it("keeps the caller's own headers alongside it", () => {
    const logger = requestLogger("POST /api/auth/verify", post());
    const response = jsonWithCorrelation(logger, {}, {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": "5" },
    });

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(response.headers.get(CORRELATION_HEADER)).toBe(logger.correlationId);
  });

  it("defaults to 200 when no status is given", () => {
    const logger = requestLogger("POST /api/auth/challenge", post());
    expect(jsonWithCorrelation(logger, { ok: true }).status).toBe(200);
  });
});
