/**
 * Per-request logging for API routes.
 *
 * Gives each request one correlation id, carried on every line it logs and
 * returned to the caller in the `x-request-id` response header. That header is
 * what makes a user report actionable: "sign-in failed, request id abc123"
 * points straight at the server-side stack trace, without the client ever being
 * told why it failed.
 *
 * Server-side auth logging deliberately records the *outcome* of every attempt,
 * not just the crashes. A spike in 401s is the signal that someone is probing
 * wallets; a spike in 503s means the deployment is misconfigured. Neither is
 * visible if only thrown exceptions are logged.
 */
import { NextResponse } from "next/server";
import {
  CORRELATION_HEADER,
  correlationIdFrom,
  logInfo,
  logWarn,
  reportError,
  type Fields,
} from "@/lib/observability/logger";

export interface RequestLogger {
  correlationId: string;
  /** Adds the correlation header to a response's headers. */
  headers(extra?: Record<string, string>): Record<string, string>;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, error?: unknown, fields?: Fields): void;
  /**
   * Logs the request's outcome. Call once per response so every request has
   * exactly one terminal line to count and alert on.
   */
  finish(event: string, status: number, fields?: Fields): void;
}

/**
 * Builds a logger bound to one request.
 *
 * `route` is recorded on every line so a drain can filter to one endpoint
 * without parsing the event name.
 */
export function requestLogger(route: string, request: Request): RequestLogger {
  const correlationId = correlationIdFrom(request.headers);
  const startedAt = Date.now();
  const base: Fields = { route };

  return {
    correlationId,

    headers(extra: Record<string, string> = {}) {
      return { ...extra, [CORRELATION_HEADER]: correlationId };
    },

    info(event, fields) {
      logInfo(event, { correlationId, fields: { ...base, ...fields } });
    },

    warn(event, fields) {
      logWarn(event, { correlationId, fields: { ...base, ...fields } });
    },

    error(event, error, fields) {
      reportError(event, error, { correlationId, fields: { ...base, ...fields } });
    },

    finish(event, status, fields) {
      const durationMs = Date.now() - startedAt;
      // 5xx is our fault and pages someone; 4xx is the caller's and is only
      // worth a warning, but both must be countable.
      const record = { ...base, status, durationMs, ...fields };
      if (status >= 500) logWarn(event, { correlationId, fields: record });
      else logInfo(event, { correlationId, fields: record });
    },
  };
}

/**
 * JSON response carrying the correlation id.
 *
 * Returning the id to a failed caller is what lets a user quote it in a support
 * message. It is a random opaque value tied to no account, so exposing it
 * reveals nothing; the error *body* stays as vague as it already was.
 */
export function jsonWithCorrelation(
  logger: RequestLogger,
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): NextResponse {
  return NextResponse.json(body as Record<string, unknown>, {
    status: init.status ?? 200,
    headers: logger.headers(init.headers),
  });
}
