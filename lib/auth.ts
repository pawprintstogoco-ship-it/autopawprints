import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireEnv } from "@/lib/env";

const SESSION_COOKIE = "pawprints_admin_session";

function signSession(email: string) {
  const { SESSION_SECRET } = requireEnv();
  return createHmac("sha256", SESSION_SECRET).update(email).digest("hex");
}

export async function createAdminSession(email: string) {
  const cookieStore = await cookies();
  cookieStore.set(
    SESSION_COOKIE,
    `${email}:${signSession(email)}`,
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/"
    }
  );
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function requireAdminSession() {
  const { ADMIN_EMAIL } = requireEnv();
  const cookieStore = await cookies();
  const value = cookieStore.get(SESSION_COOKIE)?.value;

  if (!value) {
    redirect("/login");
  }

  const [email, signature] = value.split(":");
  if (!email || !signature) {
    redirect("/login");
  }

  const expected = signSession(email);
  const valid =
    email === ADMIN_EMAIL &&
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!valid) {
    redirect("/login");
  }

  return { email };
}
