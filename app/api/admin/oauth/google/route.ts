import { NextResponse } from "next/server";
import { createAdminOAuthState, isGoogleOAuthConfigured } from "@/lib/auth";
import { requireEnv } from "@/lib/env";

export async function GET(request: Request) {
  if (!isGoogleOAuthConfigured()) {
    return NextResponse.redirect(new URL("/login?error=oauth_config", request.url), {
      status: 303
    });
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_OAUTH_REDIRECT_URI } = requireEnv();
  const state = await createAdminOAuthState();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", GOOGLE_OAUTH_REDIRECT_URI!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");

  return NextResponse.redirect(url, {
    status: 303,
    headers: {
      "cache-control": "no-store"
    }
  });
}
