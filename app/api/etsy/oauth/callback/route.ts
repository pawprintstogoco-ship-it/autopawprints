import { NextResponse } from "next/server";
import { exchangeEtsyAuthorizationCode } from "@/lib/etsy";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.json({ error: "Missing Etsy OAuth code or state" }, { status: 400 });
  }

  try {
    await exchangeEtsyAuthorizationCode({ code, state });
    return NextResponse.redirect(new URL("/etsy?connected=1", request.url));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Etsy OAuth failed" },
      { status: 500 }
    );
  }
}
