import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { markNeedsManualAttention } from "@/lib/orders";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await requireAdminSession();
  const { id } = await context.params;
  const formData = await request.formData();
  const reason = String(formData.get("reason") ?? "Manual review requested");
  await markNeedsManualAttention(id, reason);

  return NextResponse.redirect(new URL(`/orders/${id}`, request.url), {
    status: 303
  });
}
