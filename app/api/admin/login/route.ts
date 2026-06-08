import { NextResponse } from "next/server";
import { createLocalAdminSession, isLocalAdminLoginConfigured } from "@/lib/auth";

export async function POST(request: Request) {
  if (!isLocalAdminLoginConfigured()) {
    return NextResponse.redirect(new URL("/login?error=local_config", request.url), {
      status: 303
    });
  }

  const formData = await request.formData();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    await createLocalAdminSession({ email, password });
  } catch {
    return NextResponse.redirect(new URL("/login?error=local_credentials", request.url), {
      status: 303
    });
  }

  return NextResponse.redirect(new URL("/orders", request.url), {
    status: 303
  });
}
