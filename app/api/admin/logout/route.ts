import { NextResponse } from "next/server";
import { clearAdminSession } from "@/lib/auth";

export async function POST(request: Request) {
  await clearAdminSession();
  return NextResponse.redirect(new URL("/login", request.url), {
    status: 303
  });
}
