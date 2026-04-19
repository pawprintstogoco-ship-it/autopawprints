import { NextResponse } from "next/server";
import { createAdminSession } from "@/lib/auth";
import { requireEnv } from "@/lib/env";
import { clearRateLimit, getRequestIp, registerRateLimitedFailure } from "@/lib/http";

const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (
    contentType &&
    !contentType.startsWith("application/x-www-form-urlencoded") &&
    !contentType.startsWith("multipart/form-data")
  ) {
    return NextResponse.json(
      { error: "Unsupported content type. Please submit the login form again." },
      { status: 415 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid login request. Please try again." },
      { status: 400 }
    );
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = requireEnv();
  const rateLimitKey = `admin-login:${getRequestIp(request)}:${email.trim().toLowerCase() || "unknown"}`;

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    const rateLimit = await registerRateLimitedFailure(
      rateLimitKey,
      LOGIN_RATE_LIMIT,
      LOGIN_RATE_LIMIT_WINDOW_MS
    );

    if (rateLimit.limited) {
      console.warn(`[auth] admin login rate limited for ${email || "unknown"}`);
      return NextResponse.json(
        { error: "Too many login attempts. Please wait a few minutes and try again." },
        {
          status: 429,
          headers: {
            "retry-after": String(rateLimit.retryAfterSeconds),
            "cache-control": "no-store"
          }
        }
      );
    }

    return NextResponse.redirect(new URL("/login", request.url), {
      status: 303
    });
  }

  await clearRateLimit(rateLimitKey);
  await createAdminSession(email);
  return NextResponse.redirect(new URL("/orders", request.url), {
    status: 303
  });
}
