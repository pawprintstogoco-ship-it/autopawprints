"use client";

import { useState } from "react";

export function ManualMessageTools({
  deliveryUrl,
  message
}: {
  deliveryUrl: string;
  message: string;
}) {
  const [copied, setCopied] = useState<"link" | "message" | null>(null);

  async function copyText(value: string, kind: "link" | "message") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => {
        setCopied((current) => (current === kind ? null : current));
      }, 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <article className="card stack">
      <div className="eyebrow">Manual Etsy message</div>
      <span className="muted">Copy and paste this into Etsy chat after approval.</span>
      <input className="uploadTextInput" value={deliveryUrl} readOnly />
      <textarea className="uploadTextarea" value={message} rows={4} readOnly />
      <div className="actions">
        <button
          className="buttonSecondary"
          type="button"
          onClick={() => copyText(deliveryUrl, "link")}
        >
          {copied === "link" ? "Copied link" : "Copy delivery link"}
        </button>
        <button
          className="buttonSecondary"
          type="button"
          onClick={() => copyText(message, "message")}
        >
          {copied === "message" ? "Copied message" : "Copy Etsy message"}
        </button>
      </div>
    </article>
  );
}
