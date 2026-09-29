"use client";

/**
 * Installs client-side error reporting.
 *
 * Renders nothing. It sits at the top of the provider tree in `app/layout.tsx`
 * so the reporter is attached before any provider can throw.
 *
 * Besides installing the reporter, it catches the two failure classes React
 * error boundaries never see:
 *
 *  - `unhandledrejection` — a rejected promise with no `.catch`. Most of this
 *    app's failure paths are async (wallet signing, Supabase writes, Soroban
 *    RPC), so this is where a dropped await actually surfaces.
 *  - `error` — a synchronous error outside React's render cycle, e.g. thrown
 *    from an event handler or a timer.
 */
import { useEffect } from "react";
import { initObservability } from "@/lib/observability/init";
import { reportError } from "@/lib/observability/logger";

export function ObservabilityInit() {
  useEffect(() => {
    initObservability();

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportError("ui.unhandled_rejection", event.reason, {
        fields: { url: window.location.pathname },
      });
    };

    const onError = (event: ErrorEvent) => {
      reportError("ui.uncaught_error", event.error ?? event.message, {
        fields: {
          url: window.location.pathname,
          // Not event.filename + line: a minified bundle path is noise, and the
          // stack on the error object is what the reporter can actually map.
          source: event.filename ? "script" : "inline",
        },
      });
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onError);

    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
