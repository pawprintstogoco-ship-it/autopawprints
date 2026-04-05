import { PrismaClient } from "@prisma/client";

declare global {
  var prisma: PrismaClient | undefined;
}

function getPrismaDatabaseUrl() {
  const originalUrl = process.env.DATABASE_URL;

  if (!originalUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(originalUrl);

    if (!parsed.searchParams.has("connection_limit")) {
      // Serverless runtimes can fan out many short-lived Prisma clients. Keeping
      // each instance to a single pooled DB connection reduces pool exhaustion.
      parsed.searchParams.set("connection_limit", "1");
    }

    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", "20");
    }

    return parsed.toString();
  } catch {
    return originalUrl;
  }
}

const prismaDatabaseUrl = getPrismaDatabaseUrl();

export const prisma =
  global.prisma ??
  new PrismaClient({
    ...(prismaDatabaseUrl
      ? {
          datasources: {
            db: {
              url: prismaDatabaseUrl
            }
          }
        }
      : {}),
    log: ["error", "warn"]
  });

global.prisma = prisma;
