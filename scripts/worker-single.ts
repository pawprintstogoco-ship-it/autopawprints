import { processRenderJob } from "../lib/orders";

async function main() {
  const renderJobId = process.argv[2];

  if (!renderJobId) {
    console.error("[worker-single] No renderJobId provided");
    process.exit(1);
  }

  console.log(`[worker-single] Starting job ${renderJobId}...`);

  try {
    await processRenderJob(renderJobId);
    console.log(`[worker-single] Job ${renderJobId} completed successfully.`);
    process.exit(0);
  } catch (error) {
    console.error(`[worker-single] Job ${renderJobId} failed:`, error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[worker-single] fatal error", error);
  process.exit(1);
});
