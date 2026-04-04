import { notFound } from "next/navigation";
import { getOrderByUploadToken } from "@/lib/orders";
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
  const isReadyForDownload = Boolean(order.downloadToken && order.status === "DELIVERED");
  const hasUploadedPhoto = Boolean(latestUpload);
  const statusLabel = order.status.replaceAll("_", " ");
  const processSteps = [
    {
      label: "Upload",
      active: true
    },
    {
      label: "Artist review",
      active: hasUploadedPhoto || order.status === "AWAITING_APPROVAL" || isReadyForDownload
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
            <span className="uploadOrderMeta">Upload portal</span>
          </div>

          <div className="uploadHero">
            <div className="uploadHeroCopy">
              <h1>Refining the portrait.</h1>
              <p>Upload your photo and pet name.</p>
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

          <div className="uploadQuickTips" role="note" aria-label="Upload tips">
            <span className="uploadQuickTip">Clear face</span>
            <span className="uploadQuickTip">Good light</span>
            <span className="uploadQuickTip">Exact pet name</span>
          </div>
        </div>

        <div className="uploadFlow">
          <div className="uploadWorkGrid">
            <section className="uploadFormCard">
              {query.success === "1" || hasUploadedPhoto ? (
                <div className="uploadSuccessBanner" role="status">
                  Photo received. Your portrait is now under artist review.
                </div>
              ) : null}

              <div className="uploadSectionHeader">
                <div>
                  <div className="eyebrow">Upload details</div>
                  <h2>Make it feel like them.</h2>
                </div>
                <p>{accentCopy}</p>
              </div>

              {hasUploadedPhoto ? (
                <div className="uploadLockedMessage">
                  Upload is complete for this order. We&apos;ll contact you once the portrait
                  review is finished.
                </div>
              ) : (
                <UploadForm token={token} />
              )}
            </section>

            <section className="uploadPortraitCard">
              <div className="uploadPortraitFrame">
                <img
                  alt="Artist sketching a pet portrait"
                  src="/brand/artist-working.svg"
                />

                <div className="uploadFloatingMeta">
                  <span>
                    {hasUploadedPhoto ? "Under review" : "Upload pending"}
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
                ) : hasUploadedPhoto ? (
                  <>
                    <h3>Under review</h3>
                    <p>
                      Our artist is now working on your pet portrait. We&apos;ll update this page
                      when the review step is complete.
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
        </div>
      </section>
    </main>
  );
}
