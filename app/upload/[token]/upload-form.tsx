"use client";

import { useState } from "react";

export function UploadForm({ token }: { token: string }) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <form
      className="stack"
      action={`/api/uploads/${token}`}
      method="post"
      encType="multipart/form-data"
      onSubmit={() => setIsSubmitting(true)}
    >
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
