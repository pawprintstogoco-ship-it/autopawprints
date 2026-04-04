"use client";

import { useState } from "react";

export function ManualMessageTools({
  initialUrl,
  initialMessage,
  deliveryUrl,
  deliveryMessage
}: {
  initialUrl: string;
  initialMessage: string;
  deliveryUrl?: string;
  deliveryMessage?: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copyText(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => {
        setCopied((current) => (current === key ? null : current));
      }, 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <article className="card stack">
      <div className="eyebrow">Manual Etsy message</div>
      <span className="muted">Copy and paste into Etsy chat.</span>

      <strong>Initial link</strong>
      <input className="uploadTextInput" value={initialUrl} readOnly />
      <textarea className="uploadTextarea" value={initialMessage} rows={4} readOnly />
      <div className="actions">
        <button
          className="buttonSecondary"
          type="button"
          onClick={() => copyText(initialUrl, "initial_link")}
        >
          {copied === "initial_link" ? "Copied link" : "Copy initial link"}
        </button>
        <button
          className="buttonSecondary"
          type="button"
          onClick={() => copyText(initialMessage, "initial_message")}
        >
          {copied === "initial_message" ? "Copied message" : "Copy initial message"}
        </button>
      </div>

      <strong>Portrait ready link</strong>
      {deliveryUrl && deliveryMessage ? (
        <>
          <input className="uploadTextInput" value={deliveryUrl} readOnly />
          <textarea className="uploadTextarea" value={deliveryMessage} rows={4} readOnly />
          <div className="actions">
            <button
              className="buttonSecondary"
              type="button"
              onClick={() => copyText(deliveryUrl, "delivery_link")}
            >
              {copied === "delivery_link" ? "Copied link" : "Copy ready link"}
            </button>
            <button
              className="buttonSecondary"
              type="button"
              onClick={() => copyText(deliveryMessage, "delivery_message")}
            >
              {copied === "delivery_message" ? "Copied message" : "Copy ready message"}
            </button>
          </div>
        </>
      ) : (
        <span className="muted">
          Available after you click Approve and deliver.
        </span>
      )}
    </article>
  );
}
