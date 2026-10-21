import { NextResponse } from "next/server";
import { WALLET_CLAIM } from "@/lib/auth/constants";
import { verifyJwt } from "@/lib/auth/jwt";
import { getSessionCookie } from "@/lib/auth/sessionCookie";
import { AuthConfigError, getJwtSecret } from "@/lib/auth/serverConfig";
import { requestLogger } from "@/lib/observability/requestLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PATCH", "DELETE"]);
const FORWARDED_HEADERS = [
  "accept",
  "accept-profile",
  "content-profile",
  "content-type",
  "prefer",
  "range",
  "range-unit",
] as const;
const RESPONSE_HEADERS = [
  "content-range",
  "content-type",
  "preference-applied",
  "vary",
] as const;

type RouteContext = { params: { path: string[] } };

async function proxy(request: Request, context: RouteContext): Promise<Response> {
  const logger = requestLogger("api.supabase.proxy", request);
  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    logger.finish("supabase.proxy_completed", 405, { method });
    return NextResponse.json(
      { error: "Method not allowed." },
      { status: 405, headers: { ...logger.headers(NO_STORE), Allow: [...ALLOWED_METHODS].join(", ") } },
    );
  }

  const path = context.params.path;
  if (
    path.length < 3 ||
    path[0] !== "rest" ||
    path[1] !== "v1" ||
    path.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
  ) {
    logger.finish("supabase.proxy_completed", 404, { method });
    return NextResponse.json(
      { error: "Not found." },
      { status: 404, headers: logger.headers(NO_STORE) },
    );
  }

  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) {
      logger.warn("supabase.proxy_origin_rejected", { method });
      logger.finish("supabase.proxy_completed", 403, { method });
      return NextResponse.json(
        { error: "Cross-origin requests are not allowed." },
        { status: 403, headers: logger.headers(NO_STORE) },
      );
    }
  }

  const token = getSessionCookie(request);
  if (!token) {
    logger.finish("supabase.proxy_completed", 401, { method, reason: "missing_session" });
    return NextResponse.json(
      { error: "Wallet sign-in is required." },
      { status: 401, headers: logger.headers(NO_STORE) },
    );
  }

  let claims: Record<string, unknown> | null;
  try {
    claims = verifyJwt(token, getJwtSecret());
  } catch (error) {
    if (!(error instanceof AuthConfigError)) throw error;
    logger.error("supabase.proxy_config_missing", error);
    logger.finish("supabase.proxy_completed", 503, { method, reason: "config_missing" });
    return NextResponse.json(
      { error: "Wallet authentication is not configured on this server." },
      { status: 503, headers: logger.headers(NO_STORE) },
    );
  }

  if (
    !claims ||
    typeof claims[WALLET_CLAIM] !== "string" ||
    claims.role !== "authenticated"
  ) {
    logger.finish("supabase.proxy_completed", 401, { method, reason: "invalid_session" });
    return NextResponse.json(
      { error: "Wallet sign-in is required." },
      { status: 401, headers: logger.headers(NO_STORE) },
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    logger.error("supabase.proxy_config_missing", undefined, {
      detail: "Supabase URL or anon key is not configured.",
    });
    logger.finish("supabase.proxy_completed", 503, { method, reason: "supabase_config_missing" });
    return NextResponse.json(
      { error: "Database access is not configured on this server." },
      { status: 503, headers: logger.headers(NO_STORE) },
    );
  }

  const upstreamUrl = new URL(
    `/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`,
    supabaseUrl,
  );
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("apikey", anonKey);
  headers.set("Authorization", `Bearer ${token}`);

  try {
    const upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
    });
    const responseHeaders = new Headers(logger.headers(NO_STORE));
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    const body = method === "HEAD" || upstream.status === 204
      ? null
      : await upstream.arrayBuffer();
    logger.finish("supabase.proxy_completed", upstream.status, { method });
    return new Response(
      body,
      { status: upstream.status, headers: responseHeaders },
    );
  } catch (error) {
    logger.error("supabase.proxy_upstream_failed", error, { method });
    logger.finish("supabase.proxy_completed", 502, { method, reason: "upstream_unavailable" });
    return NextResponse.json(
      { error: "The database service is temporarily unavailable." },
      { status: 502, headers: logger.headers(NO_STORE) },
    );
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
