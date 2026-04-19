import { getRedisConnection } from "@/lib/queue";

export function getSafeRedirectPath(value: string | null | undefined, fallback: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  try {
    const parsed = new URL(value, "https://pawprints.local");
    if (parsed.origin !== "https://pawprints.local") {
      return fallback;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function getRequestIp(request: Request) {
  const trustedHeaders = [
    request.headers.get("x-real-ip"),
    request.headers.get("x-vercel-forwarded-for"),
    request.headers.get("cf-connecting-ip")
  ];

  for (const headerValue of trustedHeaders) {
    if (headerValue?.trim()) {
      return headerValue.trim();
    }
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") || "unknown";
}

export async function registerRateLimitedFailure(key: string, limit: number, windowMs: number) {
  const redis = getRedisConnection();
  const bucketKey = `rate-limit:${key}`;
  const count = await redis.incr(bucketKey);

  if (count === 1) {
    await redis.pexpire(bucketKey, windowMs);
  }

  const ttlMs = await redis.pttl(bucketKey);

  return {
    limited: count >= limit,
    retryAfterSeconds: Math.max(1, Math.ceil(Math.max(ttlMs, 1) / 1000))
  };
}

export async function clearRateLimit(key: string) {
  await getRedisConnection().del(`rate-limit:${key}`);
}
