/**
 * Structured logging and error reporting.
 *
 * Replaces bare `console.error(...)` across the stack. The problem with the bare
 * calls was not that they printed too little, but that they printed prose: a
 * platform log drain cannot filter, count or alert on `"Failed to sign out:"`,
 * so in production every failure was invisible. Every line here is a single JSON
 * object with a stable `event` name, which a drain can query and alert on.
 *
 * Three deliberate choices:
 *
 * 1. `console.*` is still the transport. `next.config.mjs` strips `console.log`
 *    in production but keeps `error`/`warn`/`info`, and on every serverless host
 *    stdout/stderr *is* the log pipeline. Writing JSON to it needs no dependency
 *    and no network call on the request path.
 * 2. Error reporting is behind a provider-agnostic `reporter` hook, so wiring
 *    Sentry (or any SDK) is `setErrorReporter(...)` in one place — see
 *    `docs/OBSERVABILITY.md` — rather than a refactor of 30 call sites.
 * 3. Everything is redacted before emit (`./redact`). These are the code paths
 *    handling tokens, signed XDR and wallet addresses.
 */
import { redact, redactText } from "@/lib/observability/redact";

export type Level = "debug" | "info" | "warn" | "error";

/** Structured fields attached to a log line. Values are redacted before emit. */
export type Fields = Record<string, unknown>;

export interface LogRecord {
  level: Level;
  /**
   * Stable, greppable identifier for *what happened*, in
   * `area.thing_that_happened` form (e.g. `auth.verify_failed`). Alerts are
   * written against this, so it must not embed variable data.
   */
  event: string;
  /** Ties every line from one request together. */
  correlationId?: string;
  message?: string;
  fields?: Fields;
  timestamp: string;
}

/* ─── Error reporting hook ─────────────────────────────────────────────────── */

export interface ErrorReport {
  event: string;
  correlationId?: string;
  error?: unknown;
  fields?: Fields;
}

export type ErrorReporter = (report: ErrorReport) => void;

let reporter: ErrorReporter | null = null;

/**
 * Installs an error reporter. Call once at startup, from
 * `instrumentation.ts` (server) or a client provider.
 *
 * A throwing or slow reporter must never take down the request that was already
 * failing, so `reportError` isolates it.
 */
export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

export function getErrorReporter(): ErrorReporter | null {
  return reporter;
}

/* ─── Correlation ids ─────────────────────────────────────────────────────── */

/**
 * Header carrying a correlation id between client, server and log drain. Matches
 * the de-facto name most platforms already propagate.
 */
export const CORRELATION_HEADER = "x-request-id";

/**
 * Short, collision-resistant id. `crypto.randomUUID` exists in the browser, in
 * Node and on the edge runtime; the fallback covers older runtimes only.
 */
export function newCorrelationId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    }
  } catch {
    // Fall through to the arithmetic fallback.
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Reuses an inbound correlation id so one user action keeps a single id across
 * client and server, and mints one otherwise.
 *
 * The inbound value is caller-controlled, so it is constrained to a short
 * alphanumeric token: an attacker must not be able to inject newlines and forge
 * extra log records, or bloat every line with a megabyte of header.
 */
export function correlationIdFrom(headers: Headers | null | undefined): string {
  const raw = headers?.get(CORRELATION_HEADER);
  if (raw) {
    const cleaned = raw.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    if (cleaned.length >= 8) return cleaned;
  }
  return newCorrelationId();
}

/* ─── Emit ────────────────────────────────────────────────────────────────── */

/** Test seam: lets a test capture records without spying on console. */
let sink: ((record: LogRecord) => void) | null = null;

export function setLogSink(next: ((record: LogRecord) => void) | null): void {
  sink = next;
}

function consoleFor(level: Level): (message?: unknown, ...rest: unknown[]) => void {
  switch (level) {
    case "error":
      return console.error;
    case "warn":
      return console.warn;
    // `console.log` is stripped from production builds by next.config.mjs;
    // `info` survives, so debug/info both route through it to stay visible.
    default:
      return console.info;
  }
}

function emit(record: LogRecord): void {
  if (sink) {
    sink(record);
    return;
  }

  // One JSON object per line: the format every log drain can parse.
  // JSON.stringify can still throw on a BigInt or a circular ref that survived
  // redaction, so degrade to a plain line rather than throwing inside a
  // catch block.
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({
      level: record.level,
      event: record.event,
      correlationId: record.correlationId,
      message: "[log serialisation failed]",
      timestamp: record.timestamp,
    });
  }

  consoleFor(record.level)(line);
}

export interface LogOptions {
  correlationId?: string;
  message?: string;
  fields?: Fields;
}

export function log(level: Level, event: string, options: LogOptions = {}): LogRecord {
  const record: LogRecord = {
    level,
    event,
    correlationId: options.correlationId,
    message: options.message ? redactText(options.message) : undefined,
    fields: options.fields ? (redact(options.fields) as Fields) : undefined,
    timestamp: new Date().toISOString(),
  };

  emit(record);
  return record;
}

/* ─── Level helpers ───────────────────────────────────────────────────────── */

export const logDebug = (event: string, options?: LogOptions) => log("debug", event, options);
export const logInfo = (event: string, options?: LogOptions) => log("info", event, options);
export const logWarn = (event: string, options?: LogOptions) => log("warn", event, options);

/**
 * Logs an error and forwards it to the installed reporter.
 *
 * This is the function that replaces `console.error(...)` in a catch block. The
 * reporter is called inside its own try/catch: a broken reporter must not turn a
 * handled 503 into an unhandled crash.
 */
export function reportError(
  event: string,
  error?: unknown,
  options: LogOptions = {},
): LogRecord {
  const record = log("error", event, {
    ...options,
    fields: { ...options.fields, error: error === undefined ? undefined : redact(error) },
  });

  if (reporter) {
    try {
      reporter({
        event,
        correlationId: options.correlationId,
        error,
        // The reporter gets redacted fields for the same reason the log does:
        // it is a third-party sink.
        fields: record.fields,
      });
    } catch (reporterError) {
      // Never recurse through reportError here — a reporter that throws every
      // time would loop.
      log("warn", "observability.reporter_failed", {
        correlationId: options.correlationId,
        fields: { error: redact(reporterError) },
      });
    }
  }

  return record;
}

/* ─── Metrics ─────────────────────────────────────────────────────────────── */

/**
 * Emits a counter as a log line.
 *
 * The issue asks how often payments end in `partial_success`. Without a metrics
 * backend the honest answer is a structured, countable log line: a drain can
 * `count by name` over `event:"metric.count"`. Deliberately not an in-process
 * counter, which would be per-instance and lost on every scale-down.
 */
export function countMetric(name: string, fields: Fields = {}, value = 1): void {
  log("info", "metric.count", { fields: { metric: name, value, ...fields } });
}
