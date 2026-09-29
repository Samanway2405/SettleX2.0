/**
 * Strips secrets and personal data out of anything on its way to a log line or
 * an error reporter.
 *
 * This exists because the failure paths that most need logging are also the ones
 * handling the most sensitive values: signed XDR, bearer tokens, JWT secrets and
 * wallet addresses all pass through the auth routes' catch blocks. A log
 * pipeline is a third party — once a secret reaches it, it has leaked, and it is
 * usually retained and indexed. So redaction happens here, before emit, rather
 * than being left to each call site to remember.
 *
 * Wallet addresses are not secret, but they are the pseudonymous identity of a
 * person moving money, and a full address plus an amount in a log line
 * deanonymises them against a public ledger. They are truncated to a prefix that
 * still supports correlating one user's requests.
 */

/** Keys whose values are replaced wholesale, matched case-insensitively. */
const SECRET_KEY_PATTERN =
  /secret|token|password|passphrase|authorization|auth[-_]?key|api[-_]?key|cookie|signature|signed|xdr|private|seed|mnemonic|jwt|credential/i;

/**
 * Keys that quote user data verbatim and must never be forwarded.
 *
 * PostgREST puts the rejected row's values in `details` and `hint` — amounts and
 * wallet addresses — and the raw error object is exactly what a `catch` block
 * naturally hands to `reportError`. Dropping these here rather than at each call
 * site means a new call site cannot reintroduce the leak.
 */
const ROW_DATA_KEY_PATTERN = /^(details|hint|body|payload|row|values)$/i;

/** Keys holding a wallet address, which get truncated rather than removed. */
const WALLET_KEY_PATTERN = /wallet|publickey|public[-_]key|address|account/i;

export const REDACTED = "[redacted]";

/** How deep to walk nested structures before giving up. */
const MAX_DEPTH = 6;

/** Cap on emitted string length, so one huge XDR blob cannot flood the log. */
const MAX_STRING_LENGTH = 512;

/**
 * Shortens a Stellar address to a recognisable, non-identifying stub:
 * `GABC1234…WXYZ`. Correlating a user's own requests still works; resolving the
 * account on a public explorer does not.
 */
export function maskWalletAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** True for Stellar public keys / contract ids appearing loose in a string. */
const STELLAR_ADDRESS_IN_TEXT = /\b[GC][A-Z2-7]{55}\b/g;

/** Bearer tokens and JWTs appearing loose in free text (e.g. an error message). */
const BEARER_IN_TEXT = /\bBearer\s+[\w-]+\.?[\w-]*\.?[\w-]*/gi;
const JWT_IN_TEXT = /\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}\b/g;

/**
 * Scrubs values that appear inside a free-text string.
 *
 * Error messages are the main source of these: a thrown message can quote the
 * token or XDR it failed on, and that message is exactly what gets logged.
 */
export function redactText(input: string): string {
  let out = input
    .replace(JWT_IN_TEXT, REDACTED)
    .replace(BEARER_IN_TEXT, `Bearer ${REDACTED}`)
    .replace(STELLAR_ADDRESS_IN_TEXT, (match) => maskWalletAddress(match));

  if (out.length > MAX_STRING_LENGTH) {
    out = `${out.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
  }
  return out;
}

/**
 * Deep-copies `value`, replacing secret-looking fields with `[redacted]` and
 * truncating wallet addresses.
 *
 * Unknown shapes are handled conservatively: anything that is not a plain
 * object, array or primitive is reduced to its type name rather than serialised,
 * since custom objects (a Supabase client, a request) can carry credentials on
 * properties this function has no way to anticipate.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();

  if (depth >= MAX_DEPTH) return "[depth limit]";

  if (value instanceof Error) {
    // An allowlist, not a walk of own properties: a thrown Supabase/PostgREST
    // error carries `details` and `hint` quoting the rejected row's values, and
    // library errors attach whole request objects. Only these four fields are
    // ever emitted.
    const code = (value as Error & { code?: unknown }).code;
    return {
      name: value.name,
      message: redactText(value.message),
      // A Postgres/PostgREST error code (e.g. 42501) is what makes a failure
      // classifiable, and is not user data.
      code: typeof code === "string" || typeof code === "number" ? code : undefined,
      // Stack frames carry file paths and function names, not user data, and
      // they are the whole point of error reporting. Messages inside the stack
      // are scrubbed by the same pass.
      stack: value.stack ? redactText(value.stack) : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redact(entry, depth + 1));
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    // Only own enumerable string keys; prototype chains belong to library
    // objects we do not want to serialise.
    const keys = Object.keys(source);
    if (keys.length === 0) return {};

    const out: Record<string, unknown> = {};
    for (const key of keys.slice(0, 50)) {
      const entry = source[key];

      if (SECRET_KEY_PATTERN.test(key) || ROW_DATA_KEY_PATTERN.test(key)) {
        out[key] = REDACTED;
        continue;
      }

      if (WALLET_KEY_PATTERN.test(key) && typeof entry === "string") {
        out[key] = maskWalletAddress(entry);
        continue;
      }

      out[key] = redact(entry, depth + 1);
    }
    return out;
  }

  // Functions, symbols and anything else: report the type, never the value.
  return `[${typeof value}]`;
}
