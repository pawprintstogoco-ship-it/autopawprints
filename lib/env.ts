import { z } from "zod";

const emptyStringToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyStringToUndefined, z.string().min(1).optional());
const optionalEmail = z.preprocess(emptyStringToUndefined, z.string().email().optional());
const optionalUrl = z.preprocess(emptyStringToUndefined, z.string().url().optional());

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  APP_URL: z.string().url(),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: optionalString,
  ADMIN_PASSWORD_HASH: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_OAUTH_REDIRECT_URI: optionalUrl,
  STORAGE_ROOT: z.string().min(1),
  DELIVERY_LINK_TTL_HOURS: z.coerce.number().int().positive(),
  OPENAI_API_KEY: optionalString,
  OPENAI_IMAGE_MODEL: z.preprocess(
    emptyStringToUndefined,
    z.string().min(1).default("gpt-image-1")
  ),
  RESEND_API_KEY: optionalString,
  RESEND_WEBHOOK_SECRET: optionalString,
  EMAIL_FROM: z.preprocess(
    emptyStringToUndefined,
    z.string().min(1).default("PawPrints <onboarding@resend.dev>")
  ),
  EMAIL_REPLY_TO: optionalEmail,
  EMAIL_FORWARD_TO: z.preprocess(
    emptyStringToUndefined,
    z.string().email().default("pawprintstogoco@gmail.com")
  ),
  OPS_EMAIL: z.preprocess(
    emptyStringToUndefined,
    z.string().email().default("pawprintstogoco@gmail.com")
  ),
  ETSY_CLIENT_ID: z.string().min(1),
  ETSY_CLIENT_SECRET: z.string().default(""),
  ETSY_REDIRECT_URI: z.string().url(),
  ETSY_SHOP_ID: z.string().min(1),
  ETSY_PILOT_LISTING_ID: z.string().min(1),
  ETSY_PILOT_LISTING_IDS: optionalString,
  ETSY_WEBHOOK_CALLBACK_URL: z.string().url(),
  ETSY_WEBHOOK_SIGNING_SECRET: z.string().min(1),
  ETSY_API_BASE_URL: z.string().url(),
  ETSY_DIGITAL_SALE_MESSAGE_TEMPLATE: z.string().min(1),
  ETSY_DELIVERY_MESSAGE_TEMPLATE: z.preprocess(
    emptyStringToUndefined,
    z.string().min(1).default("Your portrait is ready. Open it here: {{DELIVERY_URL}}")
  ),
  OPENCLAW_HOOK_URL: optionalUrl,
  OPENCLAW_HOOK_TOKEN: optionalString,
  OPENCLAW_CALLBACK_SECRET: optionalString,
  OPENCLAW_AGENT_ID: optionalString,
  OPENCLAW_JOB_TIMEOUT_SECONDS: z.coerce.number().int().positive().optional()
});

export const env = envSchema.safeParse(process.env);

const fallbackDefaults = {
  OPENAI_IMAGE_MODEL: "gpt-image-1",
  EMAIL_FROM: "PawPrints <onboarding@resend.dev>",
  EMAIL_FORWARD_TO: "pawprintstogoco@gmail.com",
  OPS_EMAIL: "pawprintstogoco@gmail.com",
  ETSY_CLIENT_SECRET: "",
  ETSY_DELIVERY_MESSAGE_TEMPLATE: "Your portrait is ready. Open it here: {{DELIVERY_URL}}"
};

const optionalFallbackKeys = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "ADMIN_PASSWORD",
  "ADMIN_PASSWORD_HASH",
  "OPENAI_API_KEY",
  "OPENAI_IMAGE_MODEL",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "EMAIL_FROM",
  "EMAIL_REPLY_TO",
  "EMAIL_FORWARD_TO",
  "OPS_EMAIL",
  "ETSY_CLIENT_SECRET",
  "ETSY_PILOT_LISTING_IDS",
  "ETSY_DELIVERY_MESSAGE_TEMPLATE",
  "OPENCLAW_HOOK_URL",
  "OPENCLAW_HOOK_TOKEN",
  "OPENCLAW_CALLBACK_SECRET",
  "OPENCLAW_AGENT_ID",
  "OPENCLAW_JOB_TIMEOUT_SECONDS"
] as const;

function withFallbackDefaults() {
  const values = { ...process.env } as Record<string, unknown>;

  for (const [key, value] of Object.entries(fallbackDefaults)) {
    if (typeof values[key] !== "string" || values[key].trim() === "") {
      values[key] = value;
    }
  }

  for (const key of optionalFallbackKeys) {
    const parsed = envSchema.shape[key].safeParse(values[key]);

    if (parsed.success) {
      values[key] = parsed.data;
    } else {
      delete values[key];
    }
  }

  return values as unknown as z.infer<typeof envSchema>;
}

export function requireEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // In worker/CLI contexts we may only have a subset of keys. Keep defaults
    // for optional settings so unrelated env issues do not erase recipients.
    return withFallbackDefaults();
  }

  return result.data;
}

export function getEtsyPilotListingIds(envValues = requireEnv()) {
  const rawList = envValues.ETSY_PILOT_LISTING_IDS ?? "*";

  return rawList
    .split(",")
    .map((listingId) => listingId.trim())
    .filter(Boolean);
}

export function isEtsyPilotListingEligible({
  shopId,
  listingId,
  envValues = requireEnv()
}: {
  shopId?: string | null;
  listingId?: string | null;
  envValues?: ReturnType<typeof requireEnv>;
}) {
  if (shopId !== envValues.ETSY_SHOP_ID) {
    return false;
  }

  const allowedListingIds = getEtsyPilotListingIds(envValues);
  const allowsAllListings = allowedListingIds.some(
    (allowedListingId) => allowedListingId === "*" || allowedListingId.toLowerCase() === "all"
  );

  if (allowsAllListings) {
    return true;
  }

  return Boolean(listingId && allowedListingIds.includes(listingId));
}
