import { NextResponse } from "next/server";
import { z } from "zod";
import {
  recordInitialEtsyUploadMessageResult,
  verifyOpenClawCallbackToken
} from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

const resultSchema = z.object({
  orderId: z.string().min(1),
  receiptId: z.string().min(1),
  status: z.enum(["sent", "failed", "skipped"]),
  reason: z.string().max(2000).optional(),
  token: z.string().min(1)
});

export async function POST(request: Request) {
  let payload: z.infer<typeof resultSchema>;

  try {
    payload = resultSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (
    !verifyOpenClawCallbackToken({
      orderId: payload.orderId,
      receiptId: payload.receiptId,
      token: payload.token
    })
  ) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const order = await prisma.order.findUnique({
    where: {
      id: payload.orderId
    },
    select: {
      receiptId: true
    }
  });

  if (!order || order.receiptId !== payload.receiptId) {
    return NextResponse.json({ error: "Order mismatch" }, { status: 404 });
  }

  await recordInitialEtsyUploadMessageResult(payload);

  return NextResponse.json({ ok: true });
}
