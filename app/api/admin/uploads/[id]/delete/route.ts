import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { deleteCustomerUploadById } from "@/lib/orders";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await requireAdminSession();
  const { id } = await context.params;
  const formData = await request.formData();
  const redirectTo = String(formData.get("redirectTo") ?? "/orders/files");

  await deleteCustomerUploadById(id);

  return NextResponse.redirect(new URL(redirectTo, request.url), {
    status: 303
  });
}
