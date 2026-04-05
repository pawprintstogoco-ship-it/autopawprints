import IORedis from "ioredis";
import { Queue } from "bullmq";
import { requireEnv } from "@/lib/env";

export const ORDER_QUEUE = "pawprints-orders";

let queue: Queue | null = null;
let connection: IORedis | null = null;

export function getRedisConnection() {
  if (!connection) {
    const { REDIS_URL } = requireEnv();
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null
    });
  }

  return connection;
}

export function getQueue() {
  if (!queue) {
    queue = new Queue(ORDER_QUEUE, {
      connection: getRedisConnection()
    });
  }

  return queue;
}

export async function enqueueRenderJob(renderJobId: string) {
  await getQueue().add(
    "render",
    { renderJobId },
    {
      jobId: `render-${renderJobId}`
    }
  );
}

export async function enqueueReminder(orderId: string, label: string, delayMs: number) {
  await getQueue().add(
    "reminder",
    { orderId, label },
    {
      delay: delayMs,
      jobId: `reminder-${orderId}-${toSafeJobToken(label)}`
    }
  );
}

export async function enqueueDelivery(orderId: string) {
  await getQueue().add(
    "delivery",
    { orderId },
    {
      jobId: `delivery-${orderId}`
    }
  );
}

function toSafeJobToken(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "job";
}
