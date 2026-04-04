import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  APP_URL: z.string().url(),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  SESSION_SECRET: z.string().min(16),
  STORAGE_ROOT: z.string().min(1),
  DELIVERY_LINK_TTL_HOURS: z.coerce.number().int().positive(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_IMAGE_MODEL: z.string().min(1).default("gpt-image-1"),
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
    .default("Your portrait is ready. Open it here: {{DELIVERY_URL}}")
});

export const env = envSchema.safeParse(process.env);

export function requireEnv() {
  if (!env.success) {
    throw new Error(`Invalid environment configuration: ${env.error.message}`);
  }

  return env.data;
}
