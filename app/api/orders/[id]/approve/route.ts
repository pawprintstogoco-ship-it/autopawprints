import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { approveOrder } from "@/lib/orders";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await requireAdminSession();
  const { id } = await context.params;
  try {
    await approveOrder(id);
  } catch (error) {
    const message =
      error instanceof Error ? encodeURIComponent(error.message) : "approval_failed";
    return NextResponse.redirect(new URL(`/orders/${id}?approveError=${message}`, request.url), {
      status: 303
    });
  }

  return NextResponse.redirect(new URL(`/orders/${id}`, request.url), {
    status: 303
  });
}
