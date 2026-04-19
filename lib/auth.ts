import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createToken, hashToken } from "@/lib/tokens";

const SESSION_COOKIE = "pawprints_admin_session";
const OAUTH_STATE_COOKIE = "pawprints_admin_oauth_state";
const ADMIN_SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
const ADMIN_SESSION_ABSOLUTE_MS = 14 * 24 * 60 * 60 * 1000;
const ADMIN_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export async function createAdminSession(email: string) {
  const { ADMIN_EMAIL } = requireEnv();
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
    throw new Error("Admin session store unavailable");
  }

  cookieStore.set(
    SESSION_COOKIE,
    sessionToken,
    {
      httpOnly: true,
      sameSite: "lax",
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
  cookieStore.delete(OAUTH_STATE_COOKIE);
}

export function isGoogleOAuthConfigured() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI } = requireEnv();
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_OAUTH_REDIRECT_URI);
}

export async function createAdminOAuthState() {
  const cookieStore = await cookies();
  const state = createToken(32);
  cookieStore.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(Date.now() + ADMIN_OAUTH_STATE_TTL_MS)
  });
  return state;
}

export async function consumeAdminOAuthState() {
  const cookieStore = await cookies();
  const state = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);
  return state;
}

export async function requireAdminSession() {
  const { ADMIN_EMAIL } = requireEnv();
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
    redirect("/login");
  }

  if (!session) {
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
    redirect("/login");
  }

  return { email: session.email };
}
