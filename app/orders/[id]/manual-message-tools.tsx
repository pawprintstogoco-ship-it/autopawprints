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
      <div className="copyFieldRow">
        <input className="uploadTextInput copyFieldInput" value={initialUrl} readOnly />
        <button
          className="copyIconButton"
          type="button"
          onClick={() => copyText(initialUrl, "initial_link")}
          aria-label="Copy initial link"
          title={copied === "initial_link" ? "Copied" : "Copy initial link"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="copyIcon">
            <path
              d="M9 9h9v11H9zM6 4h9v2H8v9H6z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {copied === "initial_link" ? <span className="muted">Copied link</span> : null}
      <textarea className="uploadTextarea" value={initialMessage} rows={4} readOnly />
      <div className="actions">
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
