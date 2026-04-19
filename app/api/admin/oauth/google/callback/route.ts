import { NextResponse } from "next/server";
import { consumeAdminOAuthState, createAdminSession, isGoogleOAuthConfigured } from "@/lib/auth";
import { requireEnv } from "@/lib/env";

type GoogleTokenResponse = {
  access_token?: string;
  token_type?: string;
};

type GoogleUserInfoResponse = {
  email?: string;
  email_verified?: boolean;
};

export async function GET(request: Request) {
  if (!isGoogleOAuthConfigured()) {
    return NextResponse.redirect(new URL("/login?error=oauth_config", request.url), {
      status: 303
    });
  }

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const returnedState = requestUrl.searchParams.get("state");
  const expectedState = await consumeAdminOAuthState();

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=oauth_code", request.url), {
      status: 303
    });
  }

  if (!returnedState || !expectedState || returnedState !== expectedState) {
    return NextResponse.redirect(new URL("/login?error=oauth_state", request.url), {
      status: 303
    });
  }

  const { ADMIN_EMAIL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI } =
    requireEnv();

  let tokenResponse: GoogleTokenResponse;
  try {
    const tokenResult = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        redirect_uri: GOOGLE_OAUTH_REDIRECT_URI!,
        grant_type: "authorization_code"
      }),
      cache: "no-store"
    });

    if (!tokenResult.ok) {
      throw new Error(`token exchange failed with ${tokenResult.status}`);
    }

    tokenResponse = (await tokenResult.json()) as GoogleTokenResponse;
  } catch (error) {
    console.error("[auth] google token exchange failed", error);
    return NextResponse.redirect(new URL("/login?error=oauth_exchange", request.url), {
      status: 303
    });
  }

  if (!tokenResponse.access_token) {
    return NextResponse.redirect(new URL("/login?error=oauth_exchange", request.url), {
      status: 303
    });
  }

  let userInfo: GoogleUserInfoResponse;
  try {
    const userInfoResult = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        Authorization: `Bearer ${tokenResponse.access_token}`
      },
      cache: "no-store"
    });

    if (!userInfoResult.ok) {
      throw new Error(`userinfo request failed with ${userInfoResult.status}`);
    }

    userInfo = (await userInfoResult.json()) as GoogleUserInfoResponse;
  } catch (error) {
    console.error("[auth] google userinfo fetch failed", error);
    return NextResponse.redirect(new URL("/login?error=oauth_exchange", request.url), {
      status: 303
    });
  }

  const normalizedEmail = String(userInfo.email ?? "").trim().toLowerCase();
  if (!userInfo.email_verified || normalizedEmail !== ADMIN_EMAIL.toLowerCase()) {
    return NextResponse.redirect(new URL("/login?error=oauth_email", request.url), {
      status: 303
    });
  }

  try {
    await createAdminSession(ADMIN_EMAIL);
  } catch (error) {
    console.error("[auth] google login failed to create session", error);
    return NextResponse.redirect(new URL("/login?error=session", request.url), {
      status: 303
    });
  }

  return NextResponse.redirect(new URL("/orders", request.url), {
    status: 303,
    headers: {
      "cache-control": "no-store"
    }
  });
}
