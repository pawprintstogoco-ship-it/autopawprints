# Autopawprints Security Audit

## Executive Summary

I audited the Next.js/TypeScript application, focusing on admin authentication, tokenized customer flows, file serving, Etsy OAuth/webhooks, and storage access patterns.

The most important confirmed issues are:

1. A public file-serving route bypasses intended token-based access control and makes delivered files effectively permanent once a storage URL is exposed.
2. The upload and admin thumbnail flows allow attacker-controlled content to be served as active browser content, creating a stored XSS path into the admin surface.
3. The upload path has no file-size guardrails, which creates a straightforward denial-of-service path.

I also found weaker admin-session hardening, missing rate limiting on login, an open redirect on admin delete routes, and missing baseline security headers in app code.

I did not find committed secrets in the repo, and `.env` files are ignored by Git. The installed `next` version in `package-lock.json` is `15.5.14`, which is above the vulnerable `15.2.x` range called out in the security guidance.

## High Severity

### AP-SEC-001
- Rule ID: NEXT-AUTHZ-LOCAL-001
- Severity: High
- Location: [app/api/files/[...key]/route.ts](/Users/kevinlo/Codex/autopawprints/app/api/files/[...key]/route.ts#L20), [lib/storage.ts](/Users/kevinlo/Codex/autopawprints/lib/storage.ts#L80), [app/download/[token]/page.tsx](/Users/kevinlo/Codex/autopawprints/app/download/[token]/page.tsx#L31), [app/orders/generated/page.tsx](/Users/kevinlo/Codex/autopawprints/app/orders/generated/page.tsx#L40)
- Evidence:
```ts
// app/api/files/[...key]/route.ts
const storageKey = key.join("/");
const file = await getBuffer(storageKey);
return new NextResponse(file, {
  headers: {
    "content-type": getContentType(storageKey),
    "cache-control": "public, max-age=31536000, immutable"
  }
});

// lib/storage.ts
export function getPublicFileUrl(key: string) {
  ...
  return `/api/files/${safePath}`;
}

// app/download/[token]/page.tsx
href={getPublicFileUrl(artifact.storageKey)}
```
- Impact: Anyone who obtains a storage URL can fetch the file without an upload/download token, and the `public, immutable` cache policy makes the asset effectively permanent even after the token expires.
- Fix: Remove the generic public `/api/files/[...key]` route for sensitive order artifacts and uploads. Serve customer-facing files only through token-validated handlers, or issue short-lived signed URLs tied to an authorization check.
- Mitigation: If the route must exist, require admin auth for non-public assets and set `Cache-Control: private, no-store` on sensitive responses.
- False positive notes: This is a confirmed access-control gap, not a theoretical one. The download page currently exposes the permanent storage URL directly.

### AP-SEC-002
- Rule ID: NEXT-XSS-FILE-001
- Severity: High
- Location: [app/api/uploads/[token]/route.ts](/Users/kevinlo/Codex/autopawprints/app/api/uploads/[token]/route.ts#L32), [lib/orders.ts](/Users/kevinlo/Codex/autopawprints/lib/orders.ts#L688), [app/api/admin/uploads/[id]/thumbnail/route.ts](/Users/kevinlo/Codex/autopawprints/app/api/admin/uploads/[id]/thumbnail/route.ts#L32), [app/api/admin/artifacts/[id]/thumbnail/route.ts](/Users/kevinlo/Codex/autopawprints/app/api/admin/artifacts/[id]/thumbnail/route.ts#L50), [app/orders/files/page.tsx](/Users/kevinlo/Codex/autopawprints/app/orders/files/page.tsx#L42), [app/orders/[id]/page.tsx](/Users/kevinlo/Codex/autopawprints/app/orders/[id]/page.tsx#L141)
- Evidence:
```ts
// app/upload/[token]/upload-form.tsx
accept="image/*"

// lib/orders.ts
if (!mimeType.startsWith("image/")) {
  throw new Error("Only image uploads are supported");
}

// app/api/admin/uploads/[id]/thumbnail/route.ts
return new NextResponse(file, {
  headers: {
    "content-type": getMimeTypeForStorageKey(upload.storageKey, upload.mimeType),
  }
});
```
- Impact: A malicious customer can upload `image/svg+xml` content and have it served back to an admin browser as SVG. Because the admin UI opens these files in a new tab, this creates a stored XSS path that can execute in the application origin and steal the admin session or perform privileged actions.
- Fix: Restrict uploads to a safe raster allowlist such as JPEG/PNG/HEIC, transcode uploads server-side to a safe output format before serving them, and never reflect user-controlled MIME types directly into `Content-Type` for admin views.
- Mitigation: Add `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` for user-supplied files until the upload pipeline is fixed.
- False positive notes: This does not depend on `dangerouslySetInnerHTML`; the risk comes from serving attacker-controlled active content back to the browser.

## Medium Severity

### AP-SEC-003
- Rule ID: NEXT-DOS-UPLOAD-001
- Severity: Medium
- Location: [app/api/uploads/[token]/route.ts](/Users/kevinlo/Codex/autopawprints/app/api/uploads/[token]/route.ts#L32), [lib/orders.ts](/Users/kevinlo/Codex/autopawprints/lib/orders.ts#L682), [lib/render.ts](/Users/kevinlo/Codex/autopawprints/lib/render.ts#L25)
- Evidence:
```ts
const formData = await request.formData();
...
fileBuffer: Buffer.from(await photo.arrayBuffer())
...
const imageInfo = await analyzeImage(fileBuffer);
```
- Impact: The upload endpoint buffers the entire file in memory and immediately hands it to `sharp` without a file-size limit. An attacker with a valid upload token can send oversized or decompression-heavy payloads to exhaust memory or CPU.
- Fix: Enforce a strict maximum upload size before buffering, reject oversized `Content-Length` values, and configure `sharp` with defensive limits for pixel count and input size.
- Mitigation: Add edge or reverse-proxy request-body limits if they are not already enforced upstream.
- False positive notes: I did not inspect deployment proxy config, so upstream body limits may exist. They are not visible in app code.

### AP-SEC-004
- Rule ID: NEXT-SESSION-001
- Severity: Medium
- Location: [lib/auth.ts](/Users/kevinlo/Codex/autopawprints/lib/auth.ts#L13)
- Evidence:
```ts
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
```
- Impact: The admin session is a stateless bearer cookie with no expiry, no issuance time, and no server-side revocation list. If it is stolen once, it remains valid until the secret rotates or the cookie is manually cleared in the victim browser.
- Fix: Add a short `maxAge`, include issued-at and expiry in the signed payload, and preferably move to a server-side session store so sessions can be revoked.
- Mitigation: Rotate `SESSION_SECRET` after suspected compromise and reduce the attack window with strict idle and absolute session lifetimes.
- False positive notes: The HMAC prevents tampering, but it does not limit replay or persistence.

### AP-SEC-005
- Rule ID: NEXT-AUTH-LOGIN-001
- Severity: Medium
- Location: [app/api/admin/login/route.ts](/Users/kevinlo/Codex/autopawprints/app/api/admin/login/route.ts#L5), [lib/env.ts](/Users/kevinlo/Codex/autopawprints/lib/env.ts#L7)
- Evidence:
```ts
const { ADMIN_EMAIL, ADMIN_PASSWORD } = requireEnv();

if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
  return NextResponse.redirect(new URL("/login", request.url), {
    status: 303
  });
}
```
- Impact: The internet-facing admin login has no rate limiting, lockout, MFA, or secondary verification. A weak or reused `ADMIN_PASSWORD` can be brute-forced or credential-stuffed without app-side resistance.
- Fix: Add rate limiting and login throttling, migrate to a proper identity provider or at minimum password hashing plus MFA, and alert on repeated failures.
- Mitigation: Place the admin surface behind network-level protection or identity-aware proxying until application-level controls are improved.
- False positive notes: An upstream WAF may reduce this risk, but nothing in repo code enforces it.

## Low Severity

### AP-SEC-006
- Rule ID: NEXT-REDIRECT-001
- Severity: Low
- Location: [app/api/admin/uploads/[id]/delete/route.ts](/Users/kevinlo/Codex/autopawprints/app/api/admin/uploads/[id]/delete/route.ts#L11), [app/api/admin/artifacts/[id]/delete/route.ts](/Users/kevinlo/Codex/autopawprints/app/api/admin/artifacts/[id]/delete/route.ts#L11)
- Evidence:
```ts
const redirectTo = String(formData.get("redirectTo") ?? "/orders/files");
return NextResponse.redirect(new URL(redirectTo, request.url), {
  status: 303
});
```
- Impact: An attacker who can influence `redirectTo` can bounce an authenticated admin to an arbitrary external URL after a successful action, which is useful for phishing and trust abuse.
- Fix: Restrict redirects to a fixed allowlist of relative internal paths.
- Mitigation: Normalize unknown values back to a safe default such as `/orders/files`.
- False positive notes: This is post-action navigation abuse, not direct privilege escalation.

### AP-SEC-007
- Rule ID: NEXT-HEADERS-001
- Severity: Low
- Location: [next.config.ts](/Users/kevinlo/Codex/autopawprints/next.config.ts#L1), [app/layout.tsx](/Users/kevinlo/Codex/autopawprints/app/layout.tsx#L15)
- Evidence:
```ts
const nextConfig: NextConfig = {
  typedRoutes: true
};
```
- Impact: The app code does not set a baseline CSP, `X-Content-Type-Options`, clickjacking protection, or referrer policy. That weakens defense in depth and makes browser-side exploitation easier if another bug lands.
- Fix: Add a baseline header policy in Next config or at the edge, including CSP, `X-Content-Type-Options: nosniff`, and a frame-ancestors / frame-options policy appropriate for the product.
- Mitigation: If headers are applied by the hosting layer, verify them at runtime and document that configuration.
- False positive notes: This may already be handled by infrastructure; I could not verify that from the repository alone.

## Notes

- `.gitignore` excludes `.env` and `.env.local`, and I did not find committed secrets in the working tree.
- The installed Next.js version is `15.5.14` in [package-lock.json](/Users/kevinlo/Codex/autopawprints/package-lock.json#L2600), so the specific outdated-version issue from the reference guidance does not apply to the current lockfile state.
- I did not run runtime penetration tests against a deployed instance, so findings are limited to what is visible in the repository.

## Live Validation

Quick checks against `https://pawprints.ca` on April 5, 2026 showed:

- `GET /` returned `200 OK` with `Access-Control-Allow-Origin: *`, but no visible CSP, `X-Content-Type-Options`, `X-Frame-Options`, or `Referrer-Policy` headers in the response.
- `GET /login` returned `200 OK`.
- `GET /orders` returned `307` redirecting to `/login`, which confirms the admin route is protected at runtime.
- `GET /api/files/test` returned `404` from the deployed `/api/files/[...key]` handler.
- `GET /api/files/final/test` returned `404` from the deployed `/api/files/final/[token]` handler.

These live checks do not prove exploitability by themselves, but they do confirm that the relevant routes and missing baseline header posture are present on the public deployment.
