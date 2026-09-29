/**
 * The property that makes the fix correct: suppressing a message changes what is
 * *displayed*, never what is *recorded*. Hiding the detail from the user and
 * also losing it from the logs would trade one bug for a worse one.
 *
 * This exercises the same pair of calls `app/error.tsx` makes, since the
 * boundary itself is a client component whose render is covered elsewhere.
 */
import { userFacingMessage } from "@/lib/errors/userMessage";
import {
  reportError,
  setErrorReporter,
  setLogSink,
  type LogRecord,
} from "@/lib/observability/logger";

const RLS_TEXT = 'new row violates row-level security policy for table "expenses"';

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

/** Mirrors what the boundary does with the error it is handed. */
function handle(error: Error & { digest?: string }) {
  const { message, wasSuppressed } = userFacingMessage(error);
  reportError("ui.render_error", error, {
    correlationId: "cid-abc12345",
    fields: {
      digest: error.digest,
      boundary: "app/error",
      messageSuppressed: wasSuppressed,
    },
  });
  return { message, wasSuppressed };
}

describe("a raw Postgres error reaching the boundary", () => {
  const error = Object.assign(new Error(RLS_TEXT), {
    digest: "srv-digest-9f2c",
    code: "42501",
  });

  it("shows the user a generic line instead of the database text", () => {
    const { message } = handle(error);
    expect(message).not.toContain("row-level security");
    expect(message).not.toContain("expenses");
  });

  it("still records the full detail for debugging", () => {
    handle(error);
    const fields = records[0].fields as { error?: { message?: string; code?: unknown } };
    expect(fields.error?.message).toContain("row-level security");
    expect(fields.error?.code).toBe("42501");
  });

  it("flags the substitution so a mis-worded message can be spotted", () => {
    handle(error);
    expect((records[0].fields as { messageSuppressed?: boolean }).messageSuppressed).toBe(true);
  });

  it("records the digest and correlation id behind the reference shown to the user", () => {
    handle(error);
    expect((records[0].fields as { digest?: string }).digest).toBe("srv-digest-9f2c");
    expect(records[0].correlationId).toBe("cid-abc12345");
  });
});

describe("a message the app wrote for users", () => {
  it("is displayed unchanged and not flagged as suppressed", () => {
    const { message, wasSuppressed } = handle(new Error("Lobstr extension is not installed."));
    expect(message).toBe("Lobstr extension is not installed.");
    expect(wasSuppressed).toBe(false);
    expect((records[0].fields as { messageSuppressed?: boolean }).messageSuppressed).toBe(false);
  });
});
