import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return NextResponse.redirect(new URL("/login?error=oauth_only", request.url), {
    status: 303
  });
}
