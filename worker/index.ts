import { Worker } from "bullmq";
import { ORDER_QUEUE, getRedisConnection } from "@/lib/queue";
import {
  createReminderAlert,
  deliverApprovedOrder,
  processRenderJob
} from "@/lib/orders";

async function main() {
  const worker = new Worker(
    ORDER_QUEUE,
    async (job) => {
      switch (job.name) {
        case "render":
          await processRenderJob(String(job.data.renderJobId));
          return;
        case "reminder":
          await createReminderAlert(String(job.data.orderId), String(job.data.label));
          return;
        case "delivery":
          await deliverApprovedOrder(String(job.data.orderId));
          return;
        default:
          throw new Error(`Unknown job: ${job.name}`);
      }
    },
    {
      connection: getRedisConnection()
    }
  );

  worker.on("completed", (job) => {
    console.log(`[worker] completed ${job.name} (${job.id})`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[worker] failed ${job?.name ?? "unknown"} (${job?.id ?? "n/a"})`, error);
  });

  console.log("[worker] PawPrints worker started");
}

main().catch((error) => {
  console.error("[worker] fatal error", error);
  process.exit(1);
});
