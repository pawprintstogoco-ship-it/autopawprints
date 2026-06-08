import crypto from "node:crypto";
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

type LocalAdminCredentials = {
  email: string;
  password: string;
};

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

export function isLocalAdminLoginConfigured() {
  const { ADMIN_PASSWORD, ADMIN_PASSWORD_HASH } = requireEnv();
  return Boolean(ADMIN_PASSWORD || ADMIN_PASSWORD_HASH);
}

export async function createLocalAdminSession({
  email,
  password
}: LocalAdminCredentials) {
  const env = requireEnv();

  if (!isLocalAdminLoginConfigured()) {
    throw new Error("Local admin login is not configured");
  }

  const emailAllowed = email.trim().toLowerCase() === env.ADMIN_EMAIL.toLowerCase();
  const passwordAllowed = verifyConfiguredAdminPassword(password, env);

  if (!emailAllowed || !passwordAllowed) {
    throw new Error("Invalid admin credentials");
  }

  await createAdminSession(env.ADMIN_EMAIL);
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

function verifyConfiguredAdminPassword(
  password: string,
  envValues: ReturnType<typeof requireEnv>
) {
  const hash = envValues.ADMIN_PASSWORD_HASH;
  if (hash) {
    return verifyPasswordHash(password, hash);
  }

  const configuredPassword = envValues.ADMIN_PASSWORD;
  if (!configuredPassword) {
    return false;
  }

  return timingSafeEqualUtf8(password, configuredPassword);
}

function verifyPasswordHash(password: string, encodedHash: string) {
  const [kind, saltOrDigest, maybeDigest] = encodedHash.split(":");

  if (kind === "scrypt" && saltOrDigest && maybeDigest) {
    return verifyScryptPassword(password, saltOrDigest, maybeDigest);
  }

  if (kind === "sha256" && saltOrDigest) {
    return timingSafeEqualHex(hashSha256(password), saltOrDigest);
  }

  return timingSafeEqualHex(hashSha256(password), encodedHash);
}

function verifyScryptPassword(password: string, saltHex: string, digestHex: string) {
  const digest = Buffer.from(digestHex, "hex");
  const salt = Buffer.from(saltHex, "hex");

  if (digest.length === 0 || salt.length === 0) {
    return false;
  }

  const derived = crypto.scryptSync(password, salt, digest.length);
  return crypto.timingSafeEqual(derived, digest);
}

function hashSha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timingSafeEqualHex(leftHex: string, rightHex: string) {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");

  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function timingSafeEqualUtf8(leftValue: string, rightValue: string) {
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);

  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
