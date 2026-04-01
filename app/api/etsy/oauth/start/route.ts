import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { createEtsyAuthorizeUrl } from "@/lib/etsy";

export async function GET() {
  await requireAdminSession();
  const url = await createEtsyAuthorizeUrl();
  return NextResponse.redirect(url);
}
