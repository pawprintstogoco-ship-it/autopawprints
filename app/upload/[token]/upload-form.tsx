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
                d="M87 72C100 52 114 41 130 41C146 41 160 52 173 72C189 78 202 92 210 113C216 131 217 149 213 163C210 174 202 184 191 188C180 192 172 187 168 178C163 165 161 150 157 130C153 108 148 90 141 75L139 72C146 106 149 141 149 178C149 226 153 258 162 286H141C136 261 132 236 130 211C128 236 124 261 119 286H98C107 258 111 226 111 178C111 141 114 106 121 72L119 75C112 90 107 108 103 130C99 150 97 165 92 178C88 187 80 192 69 188C58 184 50 174 47 163C43 149 44 131 50 113C58 92 71 78 87 72Z"
                fill="#1a1511"
              />
              <path
                d="M113 73C106 95 103 129 103 170C103 207 95 229 82 248C77 255 73 264 71 275H80C82 263 88 252 97 242C112 225 120 205 120 177C120 134 118 101 113 73Z"
                fill="white"
              />
              <path
                d="M147 73C142 101 140 134 140 177C140 205 148 225 163 242C172 252 178 263 180 275H189C187 264 183 255 178 248C165 229 157 207 157 170C157 129 154 95 147 73Z"
                fill="white"
              />
              <path
                d="M127 143C115 142 103 145 96 152C89 159 89 172 96 180C101 186 109 189 117 189C122 189 126 188 130 186C134 188 138 189 143 189C151 189 159 186 164 180C171 172 171 159 164 152C157 145 145 142 133 143L130 144L127 143Z"
                fill="white"
              />
              <path
                d="M130 147C137 147 146 148 150 151C153 154 152 161 149 166C145 171 138 175 130 175C122 175 115 171 111 166C108 161 107 154 110 151C114 148 123 147 130 147Z"
                fill="#1a1511"
              />
              <path
                d="M119 176C122 182 126 186 130 186C134 186 138 182 141 176L146 180C140 189 135 194 130 194C125 194 120 189 114 180L119 176Z"
                fill="#1a1511"
              />
              <path
                d="M130 175V186"
                stroke="#1a1511"
                strokeWidth="6"
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
