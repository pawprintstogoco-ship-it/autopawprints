import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  APP_URL: z.string().url(),
  ADMIN_EMAIL: z.string().email(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  STORAGE_ROOT: z.string().min(1),
  DELIVERY_LINK_TTL_HOURS: z.coerce.number().int().positive(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_IMAGE_MODEL: z.string().min(1).default("gpt-image-1"),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).default("PawPrints <onboarding@resend.dev>"),
  EMAIL_REPLY_TO: z.string().email().optional(),
  EMAIL_FORWARD_TO: z.string().email().default("pawprintstogoco@gmail.com"),
  OPS_EMAIL: z.string().email().default("pawprintstogoco@gmail.com"),
  ETSY_CLIENT_ID: z.string().min(1),
  ETSY_CLIENT_SECRET: z.string().default(""),
  ETSY_REDIRECT_URI: z.string().url(),
  ETSY_SHOP_ID: z.string().min(1),
  ETSY_PILOT_LISTING_ID: z.string().min(1),
  ETSY_WEBHOOK_CALLBACK_URL: z.string().url(),
  ETSY_WEBHOOK_SIGNING_SECRET: z.string().min(1),
  ETSY_API_BASE_URL: z.string().url(),
  ETSY_DIGITAL_SALE_MESSAGE_TEMPLATE: z.string().min(1),
  ETSY_DELIVERY_MESSAGE_TEMPLATE: z
    .string()
    .min(1)
    .default("Your portrait is ready. Open it here: {{DELIVERY_URL}}"),
  OPENCLAW_HOOK_URL: z.string().url().optional(),
  OPENCLAW_HOOK_TOKEN: z.string().min(1).optional(),
  OPENCLAW_CALLBACK_SECRET: z.string().min(1).optional(),
  OPENCLAW_AGENT_ID: z.string().min(1).optional(),
  OPENCLAW_JOB_TIMEOUT_SECONDS: z.coerce.number().int().positive().optional()
});

export const env = envSchema.safeParse(process.env);

export function requireEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // If we're in a worker/CLI context, we might only have a subset of keys.
    // Instead of crashing everything, we'll return what we have and let the 
    // specific functions throw if they are missing a key they actually need.
    return process.env as unknown as z.infer<typeof envSchema>;
  }

  return result.data;
}
