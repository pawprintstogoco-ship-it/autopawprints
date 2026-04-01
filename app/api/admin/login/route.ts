import { NextResponse } from "next/server";
import { createAdminSession } from "@/lib/auth";
import { requireEnv } from "@/lib/env";

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = requireEnv();

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return NextResponse.redirect(new URL("/login", request.url), {
      status: 303
    });
  }

  await createAdminSession(email);
  return NextResponse.redirect(new URL("/orders", request.url), {
    status: 303
  });
}
