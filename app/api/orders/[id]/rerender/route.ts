import { after, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { enqueueRenderJob } from "@/lib/queue";
import { processRenderJob, rerenderOrder } from "@/lib/orders";

export const maxDuration = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await requireAdminSession();
  const { id } = await context.params;
  const redirectUrl = new URL(`/orders/${id}`, request.url);

  try {
    const { processingDeferred, renderJob } = await rerenderOrder(id, {
      skipProcessing: true
    });

    after(async () => {
      try {
        if (processingDeferred) {
          await processRenderJob(renderJob.id);
        } else {
          await enqueueRenderJob(renderJob.id);
        }
      } catch (error) {
        console.error(`Deferred rerender failed for order ${id}`, error);
      }
    });

    redirectUrl.searchParams.set("rerenderStarted", "1");
  } catch (error) {
    console.error(`Rerender failed for order ${id}`, error);
    const message =
      error instanceof Error ? error.message : "Re-render failed. Please try again.";
    redirectUrl.searchParams.set("rerenderError", message);
  }

  return NextResponse.redirect(redirectUrl, {
    status: 303
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await requireAdminSession();
  const { id } = await context.params;
  return NextResponse.redirect(new URL(`/orders/${id}`, request.url), {
    status: 303
  });
}
