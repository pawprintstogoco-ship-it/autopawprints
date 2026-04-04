import { notFound } from "next/navigation";
import { getOrderByUploadToken } from "@/lib/orders";
import { getPublicFileUrl } from "@/lib/storage";
import { UploadForm } from "@/app/upload/[token]/upload-form";

export default async function UploadPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ success?: string }>;
}) {
  const { token } = await params;
  const query = (await searchParams) ?? {};
  const order = await getOrderByUploadToken(token);

  if (!order) {
    notFound();
  }

  const latestUpload = order.uploads[0] ?? null;
  const preview = order.artifacts.find((artifact) => artifact.kind === "PREVIEW") ?? null;
  const finalPng = order.artifacts.find((artifact) => artifact.kind === "FINAL_PNG") ?? null;
  const isReadyForDownload = Boolean(order.downloadToken && order.status === "DELIVERED");
  const statusLabel = order.status.replaceAll("_", " ");
  const processSteps = [
    {
      label: "Upload",
      active: true
    },
    {
      label: "Artist review",
      active:
        order.status !== "AWAITING_PHOTO" &&
        order.status !== "PHOTO_RECEIVED" &&
        order.status !== "PAID"
    },
    {
      label: "Delivery",
      active: isReadyForDownload
    }
  ];
  const accentCopy = latestUpload
    ? `Your latest file for ${latestUpload.petName} is safely attached to this order.`
    : "A clear photo with good lighting helps the portrait render cleanly.";

  return (
    <main className="uploadPage">
      <div className="uploadAura uploadAuraLeft" />
      <div className="uploadAura uploadAuraRight" />

      <section className="shell uploadShell">
        <header className="uploadMasthead">
          <a href="/" className="uploadBrandLink" aria-label="PawPrints home">
            <img
              className="uploadBrandLogo uploadBrandLogoLong"
              src="/brand/pawprints-longform.svg"
              alt="PawPrints"
            />
            <img
              className="uploadBrandLogo uploadBrandLogoSquare"
              src="/brand/pawprints-square.svg"
              alt="PawPrints"
            />
          </a>
          <div className="uploadMastheadMeta">
            <span className="uploadOrderMeta">Private order link</span>
          </div>
        </header>

        <div className="uploadIntro">
          <div className="uploadKickerRow">
            <span className="uploadStatusPill">{statusLabel}</span>
            <span className="uploadOrderMeta">Secure upload portal</span>
          </div>

          <div className="uploadHero">
            <div className="uploadHeroCopy">
              <div className="eyebrow">Portrait upload</div>
              <h1>Refining the portrait.</h1>
              <p>
                Share your favorite pet photo, confirm the name exactly as you want it
                styled, and we&apos;ll take it from here.
              </p>
            </div>

            <div className="uploadStepper" aria-label="Order progress">
              {processSteps.map((step) => (
                <div
                  key={step.label}
                  className={step.active ? "uploadStepChip isActive" : "uploadStepChip"}
                >
                  {step.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="uploadFlow">
          <section className="uploadGuidanceCard uploadGuidanceHero">
            <div className="eyebrow">Before you upload</div>
            <h2 className="uploadGuidanceTitle">Quick photo checklist</h2>
            <ul className="uploadGuidanceList">
              <li>Use a single pet photo with the face fully visible.</li>
              <li>Avoid heavy shadows, screenshots, and distant shots.</li>
              <li>Enter the pet name exactly as it should appear on the portrait.</li>
            </ul>
          </section>

          <section className="uploadFormCard">
            {query.success === "1" ? (
              <div className="uploadSuccessBanner" role="status">
                Your photo was received. We&apos;ll show progress here as the portrait moves
                into review.
              </div>
            ) : null}

            <div className="uploadSectionHeader">
              <div>
                <div className="eyebrow">Upload details</div>
                <h2>Make it feel like them.</h2>
              </div>
              <p>{accentCopy}</p>
            </div>

            <UploadForm token={token} />
          </section>

          <section className="uploadPortraitCard">
            <div className="uploadPortraitFrame">
              {preview ? (
                <img
                  alt={`Preview for ${latestUpload?.petName ?? "your pet"}`}
                  src={getPublicFileUrl(preview.storageKey)}
                />
              ) : latestUpload ? (
                <img
                  alt={`Uploaded source photo for ${latestUpload.petName}`}
                  src={getPublicFileUrl(latestUpload.storageKey)}
                />
              ) : (
                <div className="uploadPlaceholderArt" aria-hidden="true">
                  <div className="uploadPlaceholderGlow" />
                  <div className="uploadPlaceholderBadge">Your portrait appears here</div>
                </div>
              )}

              <div className="uploadFloatingMeta">
                <span>
                  {preview
                    ? "Latest preview"
                    : latestUpload
                      ? "Original upload"
                      : "Awaiting upload"}
                </span>
              </div>
            </div>

            <div className="uploadPortraitBody">
              <div className="eyebrow">{latestUpload?.petName ?? order.buyerName}</div>

              {isReadyForDownload ? (
                <>
                  <h3>Your portrait is ready.</h3>
                  <p>Final review is complete and your download link is live.</p>
                  <a className="button" href={`/download/${order.downloadToken}`}>
                    Open finished portrait
                  </a>
                </>
              ) : preview ? (
                <>
                  <h3>Latest preview</h3>
                  <p>
                    The artwork is in review now. If you need a cleaner source photo,
                    you can upload a new one below.
                  </p>
                </>
              ) : finalPng ? (
                <>
                  <h3>Awaiting final review</h3>
                  <p>The portrait has rendered successfully and is waiting for approval.</p>
                </>
              ) : latestUpload ? (
                <>
                  <h3>Photo received</h3>
                  <p>
                    We&apos;ve attached your photo and the portrait is moving through the
                    render queue.
                  </p>
                </>
              ) : (
                <>
                  <h3>What makes a strong upload</h3>
                  <p>
                    Use one clear pet photo with good light, visible facial detail, and
                    minimal blur.
                  </p>
                </>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
