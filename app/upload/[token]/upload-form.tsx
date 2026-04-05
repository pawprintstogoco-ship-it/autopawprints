"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChangeEvent, FormEvent, useId, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_POSTER_BACKGROUND_STYLE,
  DEFAULT_POSTER_FONT_STYLE,
  getPosterBackgroundOption,
  getPosterFontOption,
  POSTER_BACKGROUND_OPTIONS,
  POSTER_FONT_OPTIONS,
  type PosterBackgroundStyle,
  type PosterFontStyle
} from "@/lib/poster-styles";

export function UploadForm({ token }: { token: string }) {
  const router = useRouter();
  const photoInputId = useId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [petNamePreview, setPetNamePreview] = useState("");
  const [selectedFontStyle, setSelectedFontStyle] =
    useState<PosterFontStyle>(DEFAULT_POSTER_FONT_STYLE);
  const [selectedBackgroundStyle, setSelectedBackgroundStyle] =
    useState<PosterBackgroundStyle>(DEFAULT_POSTER_BACKGROUND_STYLE);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setSelectedFileName(file?.name ?? "");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    setIsSubmitting(true);
    setIsComplete(false);
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
          setIsComplete(true);
          setIsSubmitting(false);
          window.setTimeout(() => {
            router.replace(`/upload/${token}`);
            router.refresh();
            finish();
          }, 450);
          return;
        }

        const fallback = "Upload failed. Please try again.";
        const response =
          request.response && typeof request.response === "object"
            ? (request.response as { error?: string })
            : null;

        setErrorMessage(response?.error ?? fallback);
        setIsComplete(false);
        setIsSubmitting(false);
        setUploadProgress(0);
        finish();
      });

      request.addEventListener("error", () => {
        setErrorMessage("Upload failed. Please check your connection and try again.");
        setIsComplete(false);
        setIsSubmitting(false);
        setUploadProgress(0);
        finish();
      });

      request.addEventListener("abort", () => {
        setErrorMessage("Upload was interrupted. Please try again.");
        setIsComplete(false);
        setIsSubmitting(false);
        setUploadProgress(0);
        finish();
      });

      request.send(formData);

      window.setTimeout(() => {
        if (!settled) {
          setErrorMessage("Upload timed out. Please try again.");
          setIsComplete(false);
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
          onChange={(event) => setPetNamePreview(event.target.value)}
          required
        />
      </AnimatedBlock>

      <AnimatedBlock delay={0.14} className="uploadField">
        <span className="uploadFieldLabel">Font style</span>
        <div className="uploadStyleGrid" role="radiogroup" aria-label="Font style">
          {POSTER_FONT_OPTIONS.map((option) => {
            const checked = selectedFontStyle === option.id;
            return (
              <label
                key={option.id}
                className={`uploadStyleCard uploadFontCard${checked ? " isSelected" : ""}`}
              >
                <input
                  className="uploadStyleInput"
                  type="radio"
                  name="fontStyle"
                  value={option.id}
                  checked={checked}
                  onChange={() => setSelectedFontStyle(option.id)}
                />
                <span className="uploadStyleCardHeader">
                  <span className="uploadStyleName">{option.label}</span>
                </span>
                <span
                  className="uploadFontPreview"
                  style={{
                    fontFamily: option.previewFamily,
                    color: option.previewColor
                  }}
                >
                  Bella
                </span>
                <span className="uploadStyleDescription">{option.description}</span>
              </label>
            );
          })}
        </div>
      </AnimatedBlock>

      <AnimatedBlock delay={0.18} className="uploadField">
        <span className="uploadFieldLabel">Background colour</span>
        <div className="uploadColourGrid" role="radiogroup" aria-label="Background colour">
          {POSTER_BACKGROUND_OPTIONS.map((option) => {
            const checked = selectedBackgroundStyle === option.id;
            return (
              <label
                key={option.id}
                className={`uploadStyleCard uploadColourCard${checked ? " isSelected" : ""}`}
              >
                <input
                  className="uploadStyleInput"
                  type="radio"
                  name="backgroundStyle"
                  value={option.id}
                  checked={checked}
                  onChange={() => setSelectedBackgroundStyle(option.id)}
                />
                <span
                  className="uploadColourSwatch"
                  style={{ backgroundColor: option.fill, borderColor: option.accent }}
                  aria-hidden="true"
                />
                <span className="uploadSrOnly">{option.label}</span>
              </label>
            );
          })}
        </div>
      </AnimatedBlock>

      <AnimatedBlock delay={0.22} className="uploadPosterPreview">
        <PosterPreview
          petName={petNamePreview}
          fontStyle={selectedFontStyle}
          backgroundStyle={selectedBackgroundStyle}
        />
      </AnimatedBlock>

      <AnimatedBlock delay={0.26} className="uploadField">
        <span className="uploadFieldLabel">New photo</span>
        <input
          id={photoInputId}
          className="uploadHiddenInput"
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          required
          onChange={handleFileChange}
        />
        <label htmlFor={photoInputId} className="uploadDropzone">
          <span className="uploadDropzoneIcon" aria-hidden="true">
            +
          </span>
          <span className="uploadDropzoneTitle">{selectedFileName || "Tap to upload"}</span>
          <span className="uploadDropzoneHint">
            JPG, PNG, WEBP, or HEIC under 15 MB. Choose the clearest photo you have.
          </span>
        </label>
      </AnimatedBlock>

      <AnimatePresence initial={false}>
        {isSubmitting || isComplete ? (
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
            <div className="progressLabel">
              {isComplete ? "Upload complete. Preparing your confirmation..." : `Uploading photo... ${uploadProgress}%`}
            </div>
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

      <AnimatedBlock delay={0.3} className="uploadSubmitDock">
        <motion.button
          className="uploadSubmitButton"
          type="submit"
          disabled={isSubmitting || isComplete}
          whileHover={isSubmitting || isComplete ? undefined : { y: -2, scale: 1.01 }}
          whileTap={isSubmitting || isComplete ? undefined : { scale: 0.99 }}
        >
          {isSubmitting ? (
            <span className="buttonContent">
              <span className="spinner" aria-hidden="true" />
              Uploading photo...
            </span>
        ) : isComplete ? (
          <span className="buttonContent">Upload Complete</span>
        ) : (
          <span className="buttonContent">Submit Photo</span>
        )}
      </motion.button>
      </AnimatedBlock>
    </motion.form>
  );
}

function PosterPreview({
  petName,
  fontStyle,
  backgroundStyle
}: {
  petName?: string;
  fontStyle: PosterFontStyle;
  backgroundStyle: PosterBackgroundStyle;
}) {
  const background = getPosterBackgroundOption(backgroundStyle);
  const font = getPosterFontOption(fontStyle);
  const name = petName?.trim() || "Pet Name";

  return (
    <div className="uploadPreviewCard">
      <div className="uploadPreviewMeta">
        <span>Live poster preview</span>
        <span>
          {font.label} + {background.label}
        </span>
      </div>

      <div className="uploadPosterMockupWrap">
        <div className="uploadPosterMockupShadow" aria-hidden="true" />
        <div
          className={`uploadPosterMockup uploadPosterMockup--${fontStyle}`}
          style={
            {
              "--poster-bg": background.fill,
              "--poster-accent": background.accent,
              "--poster-title": font.previewColor,
              "--poster-font": font.previewFamily
            } as CSSProperties
          }
        >
          <div className="uploadPosterName" style={{ fontFamily: font.previewFamily }}>
            {fontStyle === "site" ? name.toUpperCase() : name}
          </div>
          <div className="uploadPosterBust" aria-hidden="true">
            <div className="uploadPosterBustGlow" />
            <svg
              className="uploadPosterDog"
              viewBox="0 0 260 320"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M75 110C67 76 88 44 124 44C159 44 181 75 178 110C199 121 211 141 212 167C214 191 202 218 185 240C170 260 159 281 153 304H96C90 281 79 260 64 240C46 218 35 191 37 167C38 140 52 121 75 110Z"
                fill="rgba(54, 40, 30, 0.1)"
              />
              <path
                d="M79 112C59 97 53 69 63 47C80 56 94 74 99 98"
                stroke="rgba(54, 40, 30, 0.88)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M181 112C201 97 207 69 197 47C180 56 166 74 161 98"
                stroke="rgba(54, 40, 30, 0.88)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M83 118C80 79 101 52 130 52C159 52 180 79 177 118C199 129 211 147 212 171C213 196 202 221 184 243C168 263 157 283 151 304H109C103 283 92 263 76 243C58 221 47 196 48 171C49 147 62 129 83 118Z"
                stroke="rgba(54, 40, 30, 0.92)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M102 165C109 160 118 157 130 157C142 157 151 160 158 165"
                stroke="rgba(54, 40, 30, 0.84)"
                strokeWidth="7"
                strokeLinecap="round"
              />
              <path
                d="M118 181C122 177 126 175 130 175C134 175 138 177 142 181"
                stroke="rgba(54, 40, 30, 0.84)"
                strokeWidth="7"
                strokeLinecap="round"
              />
              <path
                d="M130 176V196"
                stroke="rgba(54, 40, 30, 0.84)"
                strokeWidth="7"
                strokeLinecap="round"
              />
              <path
                d="M105 209C114 220 121 225 130 225C139 225 146 220 155 209"
                stroke="rgba(54, 40, 30, 0.84)"
                strokeWidth="7"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
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
