import { NextResponse } from "next/server";
import { getPendingInitialEtsyUploadMessages } from "@/lib/pending-etsy-messages";
import { requireEnv } from "@/lib/env";

export async function GET(request: Request) {
  const env = requireEnv();
  const token = normalizeToken(env.OPENCLAW_HOOK_TOKEN);

  if (!token) {
    return NextResponse.json(
      { error: "OpenClaw hook token is not configured" },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const messages = await getPendingInitialEtsyUploadMessages();
  return NextResponse.json({ ok: true, messages });
}

function normalizeToken(value?: string | null) {
  const normalized = value?.trim();
  return normalized || null;
}
