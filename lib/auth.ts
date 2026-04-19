import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createToken, hashToken } from "@/lib/tokens";

const SESSION_COOKIE = "pawprints_admin_session";
const ADMIN_SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
const ADMIN_SESSION_ABSOLUTE_MS = 14 * 24 * 60 * 60 * 1000;

function signLegacySession(email: string, sessionSecret: string) {
  return createHmac("sha256", sessionSecret).update(email).digest("hex");
}

function createLegacyCookieValue(email: string, sessionSecret: string) {
  return `${email}:${signLegacySession(email, sessionSecret)}`;
}

function isValidLegacyCookieValue(
  value: string,
  adminEmail: string,
  sessionSecret: string
) {
  const [email, signature] = value.split(":");
  if (!email || !signature || email !== adminEmail) {
    return false;
  }

  const expected = signLegacySession(email, sessionSecret);
  return (
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}

export async function createAdminSession(email: string) {
  const { ADMIN_EMAIL, SESSION_SECRET } = requireEnv();
  if (email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized admin email");
  }

  const cookieStore = await cookies();
  const sessionToken = createToken(32);
  const sessionHash = hashToken(sessionToken);
  const now = Date.now();
  const idleExpiresAt = new Date(now + ADMIN_SESSION_IDLE_MS);
  const absoluteExpiresAt = new Date(now + ADMIN_SESSION_ABSOLUTE_MS);

  try {
    await prisma.adminSession.deleteMany({
      where: {
        email
      }
    });

    await prisma.adminSession.create({
      data: {
        email,
        sessionHash,
        idleExpiresAt,
        absoluteExpiresAt
      }
    });
  } catch (error) {
    console.error("[auth] failed to create admin session", error);
    if (!SESSION_SECRET) {
      throw new Error("Admin session store unavailable");
    }

    cookieStore.set(SESSION_COOKIE, createLegacyCookieValue(email, SESSION_SECRET), {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: idleExpiresAt
    });
    return;
  }

  cookieStore.set(
    SESSION_COOKIE,
    sessionToken,
    {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: idleExpiresAt
    }
  );
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (sessionToken) {
    try {
      await prisma.adminSession.deleteMany({
        where: {
          sessionHash: hashToken(sessionToken)
        }
      });
    } catch (error) {
      console.error("[auth] failed to clear admin session", error);
    }
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function requireAdminSession() {
  const { ADMIN_EMAIL, SESSION_SECRET } = requireEnv();
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;

  if (!sessionToken) {
    redirect("/login");
  }

  const sessionHash = hashToken(sessionToken);
  let session;
  try {
    session = await prisma.adminSession.findUnique({
      where: {
        sessionHash
      }
    });
  } catch (error) {
    console.error("[auth] failed to read admin session", error);
    if (SESSION_SECRET && isValidLegacyCookieValue(sessionToken, ADMIN_EMAIL, SESSION_SECRET)) {
      return { email: ADMIN_EMAIL };
    }

    redirect("/login");
  }

  if (!session) {
    if (SESSION_SECRET && isValidLegacyCookieValue(sessionToken, ADMIN_EMAIL, SESSION_SECRET)) {
      return { email: ADMIN_EMAIL };
    }

    redirect("/login");
  }

  const now = new Date();
  const expired =
    session.email !== ADMIN_EMAIL ||
    session.idleExpiresAt <= now ||
    session.absoluteExpiresAt <= now;

  if (expired) {
    try {
      await prisma.adminSession.delete({
        where: {
          sessionHash
        }
      });
    } catch (error) {
      console.error("[auth] failed to delete expired admin session", error);
    }
    redirect("/login");
  }

  const nextIdleExpiresAt = new Date(Date.now() + ADMIN_SESSION_IDLE_MS);
  try {
    await prisma.adminSession.update({
      where: {
        sessionHash
      },
      data: {
        lastSeenAt: now,
        idleExpiresAt: nextIdleExpiresAt
      }
    });
  } catch (error) {
    console.error("[auth] failed to refresh admin session", error);
    if (SESSION_SECRET && isValidLegacyCookieValue(sessionToken, ADMIN_EMAIL, SESSION_SECRET)) {
      return { email: ADMIN_EMAIL };
    }

    redirect("/login");
  }

  return { email: session.email };
}
