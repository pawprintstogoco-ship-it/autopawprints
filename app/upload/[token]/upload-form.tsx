"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function UploadForm({ token }: { token: string }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    setIsSubmitting(true);
    setUploadProgress(0);
    setErrorMessage("");

    await new Promise<void>((resolve) => {
      const request = new XMLHttpRequest();
      request.open("POST", `/api/uploads/${token}`);
      request.responseType = "json";

      request.upload.addEventListener("progress", (progressEvent) => {
        if (!progressEvent.lengthComputable) {
          return;
        }

        setUploadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
      });

      request.addEventListener("load", () => {
        if (request.status >= 200 && request.status < 400) {
          setUploadProgress(100);
          router.push(`/upload/${token}?success=1`);
          router.refresh();
          resolve();
          return;
        }

        const fallback = "Upload failed. Please try again.";
        const response =
          request.response && typeof request.response === "object"
            ? (request.response as { error?: string })
            : null;

        setErrorMessage(response?.error ?? fallback);
        setIsSubmitting(false);
        setUploadProgress(0);
        resolve();
      });

      request.addEventListener("error", () => {
        setErrorMessage("Upload failed. Please check your connection and try again.");
        setIsSubmitting(false);
        setUploadProgress(0);
        resolve();
      });

      request.send(formData);
    });
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div className="muted">
        Re-uploading a new photo will replace the current source image for the next render.
      </div>
      <label className="field">
        <span>Pet name</span>
        <input type="text" name="petName" required />
      </label>
      <label className="field">
        <span>Photo</span>
        <input type="file" name="photo" accept="image/*" required />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea
          name="notes"
          rows={5}
          placeholder="Anything we should know about the portrait?"
        />
      </label>
      {isSubmitting ? (
        <div className="stack" aria-live="polite">
          <div className="progressBar" aria-hidden="true">
            <div className="progressBarFill" style={{ width: `${uploadProgress}%` }} />
          </div>
          <div className="muted progressLabel">Uploading photo... {uploadProgress}%</div>
        </div>
      ) : null}
      {errorMessage ? (
        <div className="errorBanner" role="alert">
          {errorMessage}
        </div>
      ) : null}
      <button className="button" type="submit" disabled={isSubmitting}>
        {isSubmitting ? (
          <span className="buttonContent">
            <span className="spinner" aria-hidden="true" />
            Uploading photo...
          </span>
        ) : (
          "Submit photo"
        )}
      </button>
    </form>
  );
}
