import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { approveOrder } from "@/lib/orders";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await requireAdminSession();
  const { id } = await context.params;
  await approveOrder(id);

  return NextResponse.redirect(new URL(`/orders/${id}`, request.url), {
    status: 303
  });
}
