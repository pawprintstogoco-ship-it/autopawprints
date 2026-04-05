import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { rerenderOrder } from "@/lib/orders";

export const maxDuration = 180;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await requireAdminSession();
  const { id } = await context.params;
  const redirectUrl = new URL(`/orders/${id}`, request.url);

  try {
    await rerenderOrder(id);
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
