/**
 * Installs the error reporter.
 *
 * The project intentionally ships no error-reporting SDK as a dependency, so the
 * default reporter is the structured log line itself — which on every serverless
 * host is already collected, searchable and alertable. That is the difference
 * this change is about: a JSON line with a stable `event` can be alerted on,
 * prose in a browser console cannot.
 *
 * To send errors to Sentry (or any provider) instead, install the SDK and
 * replace the body of `defaultReporter` — or call `setErrorReporter` with your
 * own function. Nothing else in the codebase changes, because all 30+ call sites
 * go through `reportError`. See `docs/OBSERVABILITY.md`.
 */
import {
  setErrorReporter,
  type ErrorReport,
} from "@/lib/observability/logger";

/**
 * Where errors go when no SDK is wired up.
 *
 * `reportError` has already emitted the structured line by the time this runs,
 * so re-logging here would double every error. It instead marks the record as
 * unreported exactly once per process, which is the signal that the deployment
 * has no error tracking configured.
 */
let warnedNoProvider = false;

function defaultReporter(report: ErrorReport): void {
  if (warnedNoProvider) return;
  warnedNoProvider = true;

  // Deliberately console.warn and not `logWarn`: this is a one-off note about
  // the observability setup itself, and routing it through the logger while the
  // logger is mid-report invites confusion in the log stream.
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "observability.no_error_provider",
      message:
        "Errors are being logged as structured JSON but not sent to an error " +
        "tracker. Wire one up in lib/observability/init.ts — see docs/OBSERVABILITY.md.",
      firstEvent: report.event,
      timestamp: new Date().toISOString(),
    }),
  );
}

let installed = false;

/**
 * Idempotent: Next may evaluate a module more than once per process (server and
 * client bundles, hot reload), and installing twice would double-report.
 */
export function initObservability(): void {
  if (installed) return;
  installed = true;
  setErrorReporter(defaultReporter);
}

/** Test seam — lets a test re-run installation from a clean state. */
export function resetObservabilityForTests(): void {
  installed = false;
  warnedNoProvider = false;
  setErrorReporter(null);
}
