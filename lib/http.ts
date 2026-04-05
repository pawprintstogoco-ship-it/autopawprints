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

type RateLimitState = {
  count: number;
  resetAt: number;
};

const requestBuckets = new Map<string, RateLimitState>();

export function getRequestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") || "unknown";
}

export function registerRateLimitedFailure(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const existing = requestBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    requestBuckets.set(key, {
      count: 1,
      resetAt: now + windowMs
    });

    return {
      limited: false,
      retryAfterSeconds: 0
    };
  }

  existing.count += 1;
  requestBuckets.set(key, existing);

  return {
    limited: existing.count >= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
  };
}

export function clearRateLimit(key: string) {
  requestBuckets.delete(key);
}
