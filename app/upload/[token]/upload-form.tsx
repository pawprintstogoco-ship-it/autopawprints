"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useId,
  useState,
  type CSSProperties
} from "react";
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

type UploadPhase = "idle" | "uploading" | "processing" | "complete";

const MAX_DIRECT_UPLOAD_BYTES = 4 * 1024 * 1024;
const TARGET_OPTIMIZED_UPLOAD_BYTES = 3.25 * 1024 * 1024;
const MAX_OPTIMIZED_IMAGE_EDGE = 1800;

export function UploadForm({ token }: { token: string }) {
  const router = useRouter();
  const photoInputId = useId();
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [petNamePreview, setPetNamePreview] = useState("");
  const [selectedFontStyle, setSelectedFontStyle] =
    useState<PosterFontStyle>(DEFAULT_POSTER_FONT_STYLE);
  const [selectedBackgroundStyle, setSelectedBackgroundStyle] =
    useState<PosterBackgroundStyle>(DEFAULT_POSTER_BACKGROUND_STYLE);
  const uploadTimeoutMs = 180000;
  const isBusy = phase !== "idle";
  const isOverlayVisible = phase === "uploading" || phase === "processing" || phase === "complete";

  useEffect(() => {
    if (phase !== "processing") {
      return;
    }

    const timer = window.setInterval(() => {
      setUploadProgress((current) => {
        if (current >= 98) {
          return current;
        }

        const remaining = 98 - current;
        const step = Math.max(1, Math.round(remaining * 0.18));
        return Math.min(98, current + step);
      });
    }, 180);

    return () => {
      window.clearInterval(timer);
    };
  }, [phase]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setSelectedFileName(file?.name ?? "");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const photo = formData.get("photo");

    setPhase("uploading");
    setUploadProgress(0);
    setErrorMessage("");

    if (photo instanceof File) {
      try {
        const preparedPhoto = await preparePhotoForUpload(photo);
        formData.set("photo", preparedPhoto, preparedPhoto.name);
      } catch {
        setErrorMessage(
          "We couldn't prepare that photo for upload. Please try a smaller JPG or PNG image."
        );
        setPhase("idle");
        setUploadProgress(0);
        return;
      }
    }

    await new Promise<void>((resolve) => {
      const request = new XMLHttpRequest();
      request.open("POST", `/api/uploads/${token}`);
      request.responseType = "json";
      let settled = false;
      let timedOut = false;
      let timeoutHandle: number | null = null;

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeoutHandle !== null) {
          window.clearTimeout(timeoutHandle);
        }
        resolve();
      };

      request.upload.addEventListener("progress", (progressEvent) => {
        if (!progressEvent.lengthComputable) {
          return;
        }

        const byteProgress = Math.round((progressEvent.loaded / progressEvent.total) * 90);
        setPhase("uploading");
        setUploadProgress(byteProgress);
      });

      request.upload.addEventListener("load", () => {
        setPhase("processing");
        setUploadProgress((current) => Math.max(current, 90));
      });

      request.addEventListener("load", () => {
        if (request.status >= 200 && request.status < 400) {
          setPhase("complete");
          setUploadProgress(100);
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
        setPhase("idle");
        setUploadProgress(0);
        finish();
      });

      request.addEventListener("error", () => {
        setErrorMessage("Upload failed. Please check your connection and try again.");
        setPhase("idle");
        setUploadProgress(0);
        finish();
      });

      request.addEventListener("abort", () => {
        setErrorMessage(
          timedOut
            ? "Upload is taking longer than expected. Please try again in a moment."
            : "Upload was interrupted. Please try again."
        );
        setPhase("idle");
        setUploadProgress(0);
        finish();
      });

      request.send(formData);

      timeoutHandle = window.setTimeout(() => {
        if (!settled) {
          timedOut = true;
          try {
            request.abort();
          } catch {
            // no-op
          }
        }
      }, uploadTimeoutMs);
    });
  }

  const progressHeading =
    phase === "processing"
      ? "Capturing your pet's details"
      : phase === "complete"
      ? "Upload complete"
      : "Uploading your photo";
  const progressLabel =
    phase === "processing"
      ? "Capturing your pet's details for our artists..."
      : phase === "complete"
      ? "Upload complete. Refreshing your page..."
      : `Uploading your photo... ${uploadProgress}%`;

  return (
    <motion.form
      className={`uploadForm${isOverlayVisible ? " uploadFormIsBusy" : ""}`}
      onSubmit={handleSubmit}
      aria-busy={isBusy}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <fieldset className="uploadFieldset" disabled={isBusy}>
        <div className="uploadFormBody">
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

          <AnimatedBlock delay={0.22} className="uploadField">
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
                JPG, PNG, WEBP, or HEIC. Large photos are optimized before upload.
              </span>
            </label>
          </AnimatedBlock>

          <AnimatedBlock delay={0.26} className="uploadPosterPreview">
            <PosterPreview
              petName={petNamePreview}
              fontStyle={selectedFontStyle}
              backgroundStyle={selectedBackgroundStyle}
            />
          </AnimatedBlock>

          <AnimatedBlock delay={0.3} className="uploadSubmitDock">
            <motion.button
              className="uploadSubmitButton"
              type="submit"
              disabled={isBusy}
              whileHover={isBusy ? undefined : { y: -2, scale: 1.01 }}
              whileTap={isBusy ? undefined : { scale: 0.99 }}
            >
              <span className="buttonContent">Submit Photo</span>
            </motion.button>
          </AnimatedBlock>
        </div>
      </fieldset>

      <AnimatePresence initial={false}>
        {isOverlayVisible ? (
          <motion.div
            key="progress"
            className="uploadProcessingOverlay"
            aria-live="polite"
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="uploadProcessingCard"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.98 }}
            >
              <span className="uploadProcessingSpinner" aria-hidden="true" />
              <div className="uploadProcessingCopy">
                <p className="uploadProcessingEyebrow">{progressHeading}</p>
                <h3>{progressLabel}</h3>
                <p>
                  {phase === "processing"
                    ? "We're gathering the little details that help our artists make your portrait look purrfect."
                    : phase === "complete"
                    ? "Taking you to the updated order page now."
                    : "Hang tight while we transfer your image securely."}
                </p>
              </div>

              <div className="uploadProgressCard">
                <div className="progressBar uploadProgressBar" aria-hidden="true">
                  <motion.div
                    className="progressBarFill uploadProgressBarFill"
                    animate={{ width: `${uploadProgress}%` }}
                    transition={{ ease: "easeOut", duration: 0.25 }}
                  />
                </div>
                <div className="progressLabel uploadProgressLabel">
                  <span>{progressHeading}</span>
                  <span>{uploadProgress}%</span>
                </div>
              </div>
            </motion.div>
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
    </motion.form>
  );
}

async function preparePhotoForUpload(file: File) {
  if (file.size <= MAX_DIRECT_UPLOAD_BYTES) {
    return file;
  }

  const image = await loadImage(file);
  let maxEdge = MAX_OPTIMIZED_IMAGE_EDGE;
  let quality = 0.86;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not prepare image");
    }

    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, quality);

    if (blob.size <= TARGET_OPTIMIZED_UPLOAD_BYTES || attempt === 7) {
      return new File([blob], toJpegFileName(file.name), {
        type: "image/jpeg",
        lastModified: Date.now()
      });
    }

    if (quality > 0.7) {
      quality -= 0.08;
    } else {
      quality = 0.82;
      maxEdge = Math.max(1200, Math.round(maxEdge * 0.82));
    }
  }

  return file;
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Could not encode image"));
      },
      "image/jpeg",
      quality
    );
  });
}

function toJpegFileName(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  return `${baseName || "pet-photo"}.jpg`;
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
