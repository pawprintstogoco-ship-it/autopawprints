"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChangeEvent, FormEvent, useId, useState } from "react";
import { useRouter } from "next/navigation";

export function UploadForm({ token }: { token: string }) {
  const router = useRouter();
  const photoInputId = useId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setSelectedFileName(file?.name ?? "");
  }

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
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      request.upload.addEventListener("progress", (progressEvent) => {
        if (!progressEvent.lengthComputable) {
          return;
        }

        setUploadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
      });

      request.addEventListener("load", () => {
        if (request.status >= 200 && request.status < 400) {
          setUploadProgress(100);
          setIsSubmitting(false);
          router.replace(`/upload/${token}`);
          router.refresh();
          finish();
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
        finish();
      });

      request.addEventListener("error", () => {
        setErrorMessage("Upload failed. Please check your connection and try again.");
        setIsSubmitting(false);
        setUploadProgress(0);
        finish();
      });

      request.addEventListener("abort", () => {
        setErrorMessage("Upload was interrupted. Please try again.");
        setIsSubmitting(false);
        setUploadProgress(0);
        finish();
      });

      request.send(formData);

      window.setTimeout(() => {
        if (!settled) {
          setErrorMessage("Upload timed out. Please try again.");
          setIsSubmitting(false);
          setUploadProgress(0);
          try {
            request.abort();
          } catch {
            // no-op
          }
          finish();
        }
      }, 20000);
    });
  }

  return (
    <motion.form
      className="uploadForm"
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <AnimatedBlock delay={0.02} className="uploadFormNote">
        Upload one photo to start your portrait review.
      </AnimatedBlock>

      <AnimatedBlock as="label" delay={0.08} className="uploadField">
        <span className="uploadFieldLabel">Pet name</span>
        <input
          className="uploadTextInput"
          type="text"
          name="petName"
          placeholder="Enter pet name"
          required
        />
      </AnimatedBlock>

      <AnimatedBlock delay={0.14} className="uploadField">
        <span className="uploadFieldLabel">New photo</span>
        <input
          id={photoInputId}
          className="uploadHiddenInput"
          type="file"
          name="photo"
          accept="image/*"
          required
          onChange={handleFileChange}
        />
        <label htmlFor={photoInputId} className="uploadDropzone">
          <span className="uploadDropzoneIcon" aria-hidden="true">
            +
          </span>
          <span className="uploadDropzoneTitle">{selectedFileName || "Tap to upload"}</span>
          <span className="uploadDropzoneHint">
            JPG, PNG, or HEIC. Choose the clearest photo you have.
          </span>
        </label>
      </AnimatedBlock>

      <AnimatedBlock as="label" delay={0.2} className="uploadField">
        <span className="uploadFieldLabel">Notes for artist</span>
        <textarea
          className="uploadTextarea"
          name="notes"
          rows={5}
          placeholder="Any specific details we should focus on?"
        />
      </AnimatedBlock>

      <AnimatePresence initial={false}>
        {isSubmitting ? (
          <motion.div
            key="progress"
            className="uploadProgressCard"
            aria-live="polite"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <div className="progressBar" aria-hidden="true">
              <motion.div
                className="progressBarFill"
                animate={{ width: `${uploadProgress}%` }}
                transition={{ ease: "easeOut", duration: 0.2 }}
              />
            </div>
            <div className="progressLabel">Uploading photo... {uploadProgress}%</div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {errorMessage ? (
          <motion.div
            key="error"
            className="errorBanner"
            role="alert"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {errorMessage}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatedBlock delay={0.26} className="uploadSubmitDock">
        <motion.button
          className="uploadSubmitButton"
          type="submit"
          disabled={isSubmitting}
          whileHover={isSubmitting ? undefined : { y: -2, scale: 1.01 }}
          whileTap={isSubmitting ? undefined : { scale: 0.99 }}
        >
          {isSubmitting ? (
            <span className="buttonContent">
              <span className="spinner" aria-hidden="true" />
              Uploading photo...
            </span>
        ) : (
          <span className="buttonContent">Submit Photo</span>
        )}
      </motion.button>
      </AnimatedBlock>
    </motion.form>
  );
}

function AnimatedBlock({
  as,
  children,
  className,
  delay = 0
}: {
  as?: "div" | "label";
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const Component = as === "label" ? motion.label : motion.div;

  return (
    <Component
      className={className}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: "easeOut" }}
    >
      {children}
    </Component>
  );
}
