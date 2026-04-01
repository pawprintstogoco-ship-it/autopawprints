import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { syncPilotDigitalSaleMessage } from "@/lib/etsy";
import { requireEnv } from "@/lib/env";

export async function POST(request: Request) {
  await requireAdminSession();
  const { APP_URL } = requireEnv();

  try {
    await syncPilotDigitalSaleMessage(`${APP_URL}/upload/example-token`);
    return NextResponse.redirect(new URL("/etsy?saleMessage=1", request.url), {
      status: 303
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to sync digital sale message"
      },
      { status: 500 }
    );
  }
}
