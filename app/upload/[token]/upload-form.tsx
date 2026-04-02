"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function UploadForm({ token }: { token: string }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");

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
    <form className="upload-form-grid" onSubmit={handleSubmit}>
      <label className="upload-field">
        <span className="upload-field-label">Email Address</span>
        <input
          className="upload-text-input"
          type="email"
          name="buyerEmail"
          placeholder="Enter your email address..."
          autoComplete="email"
          required
        />
      </label>

      <label className="upload-field">
        <span className="upload-field-label">Pet Name</span>
        <input
          className="upload-text-input"
          type="text"
          name="petName"
          placeholder="Enter pet name..."
          required
        />
      </label>

      <label className="upload-field">
        <span className="upload-field-label">New Photo</span>
        <span className="upload-file-drop">
          <span className="upload-file-icon" aria-hidden="true">
            +
          </span>
          <span className="upload-file-copy">{selectedFileName || "Tap to upload"}</span>
          <input
            className="upload-file-input"
            type="file"
            name="photo"
            accept="image/*"
            required
            onChange={(event) =>
              setSelectedFileName(event.currentTarget.files?.[0]?.name ?? "")
            }
          />
        </span>
      </label>

      <div className="muted upload-form-note">
        Re-uploading a new photo will replace the current source image for the next render.
      </div>

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
      <button className="upload-submit-button" type="submit" disabled={isSubmitting}>
        {isSubmitting ? (
          <span className="buttonContent">
            <span className="spinner" aria-hidden="true" />
            Uploading photo...
          </span>
        ) : (
          <>
            <span>Submit photo</span>
            <span aria-hidden="true">-&gt;</span>
          </>
        )}
      </button>
    </form>
  );
}
