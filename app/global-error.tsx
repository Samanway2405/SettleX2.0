"use client";

/**
 * Last-resort error boundary.
 *
 * `app/error.tsx` is rendered *inside* the root layout, so it cannot catch an
 * error thrown by the layout itself — a crash in a provider (wallet, toast,
 * expense context) would otherwise produce a blank page with nothing logged
 * anywhere. This boundary replaces the whole document, which is why it must
 * render its own <html> and <body> and cannot use the app's providers or
 * Tailwind-dependent chrome.
 *
 * Styles are inline for the same reason: if the failure was in the layout, the
 * stylesheet may never have loaded.
 *
 * Unlike `app/error.tsx`, this boundary never renders `error.message` at all,
 * not even a vetted one. A failure this deep is a provider or bundle crash whose
 * message is always internal ("Cannot read properties of undefined", a hydration
 * mismatch), so there is nothing here worth showing a user — only the reference
 * id and a way out. The detail goes to the reporter.
 */
import { useEffect, useState } from "react";
import { newCorrelationId, reportError } from "@/lib/observability/logger";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [correlationId] = useState(newCorrelationId);

  useEffect(() => {
    reportError("ui.global_error", error, {
      correlationId,
      fields: { digest: error.digest, boundary: "app/global-error" },
    });
  }, [error, correlationId]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          margin: 0,
          background: "#F6F6F6",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          textAlign: "center",
        }}
      >
        <div
          style={{
            maxWidth: "28rem",
            width: "100%",
            background: "#fff",
            borderRadius: "1rem",
            border: "1px solid #E5E5E5",
            padding: "1.5rem",
          }}
        >
          <h2
            style={{
              fontSize: "1.125rem",
              fontWeight: 700,
              color: "#DC2626",
              margin: "0 0 0.5rem",
            }}
          >
            Something went wrong
          </h2>
          <p style={{ fontSize: "0.875rem", color: "#888", margin: "0 0 1.5rem" }}>
            The app failed to load. Your data is safe — nothing was changed.
          </p>
          <button
            onClick={() => reset()}
            style={{
              width: "100%",
              padding: "0.5rem 1rem",
              background: "#0F0F14",
              color: "#fff",
              borderRadius: "0.75rem",
              border: "none",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          <p
            style={{
              marginTop: "1rem",
              fontSize: "11px",
              color: "#AAA",
              fontFamily: "ui-monospace, monospace",
              wordBreak: "break-all",
            }}
          >
            Reference: {error.digest ?? correlationId}
          </p>
        </div>
      </body>
    </html>
  );
}
