import { notFound } from "next/navigation";
import { OrderStatus } from "@prisma/client";
import { UploadForm } from "@/app/upload/[token]/upload-form";
import { getOrderByUploadToken } from "@/lib/orders";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PawprintsCA Upload",
  description: "Upload your photo for a PawprintsCA artist to work on your portrait.",
  openGraph: {
    title: "PawprintsCA Upload",
    description: "Upload your photo for a PawprintsCA artist to work on your portrait.",
    images: ["/brand/pawprintsdrawing2.png"]
  },
  twitter: {
    title: "PawprintsCA Upload",
    description: "Upload your photo for a PawprintsCA artist to work on your portrait.",
    images: ["/brand/pawprintsdrawing2.png"]
  }
};

export default async function UploadPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token) {
    notFound();
  }

  const order = await getOrderByUploadToken(token);

  if (!order) {
    notFound();
  }

  const filledSlotIds = new Set(
    order.uploads
      .map((upload) => upload.portraitSlotId)
      .filter((slotId): slotId is string => Boolean(slotId))
  );
  const totalSlots = Math.max(1, order.portraitSlots.length);
  const nextOpenSlot = order.portraitSlots.find((slot) => !filledSlotIds.has(slot.id)) ?? null;
  const receivedCount = Math.min(order.uploads.length, totalSlots);
  const hasCompletedAllUploads = !nextOpenSlot;
  const finalArtifact = order.finalArtifacts[0] ?? null;
  const isDelivered = order.status === OrderStatus.DELIVERED && Boolean(finalArtifact);
  const finalImageUrl = isDelivered ? `/api/files/final/${token}?artifactId=${finalArtifact.id}` : null;
  const accentCopy = isDelivered
    ? "Your portrait is finished and ready for delivery."
    : hasCompletedAllUploads
    ? ""
    : totalSlots > 1
    ? `${receivedCount} of ${totalSlots} photos received. Upload the next pet photo here.`
    : "A clear photo with good lighting helps the artist draw accurate details.";

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
            <span className="uploadOrderMeta">Customer upload link</span>
          </div>
        </header>

        <div className="uploadIntro">
          <div className="uploadHero">
            <div className="uploadHeroCopy">
              <h1>PawprintsCA Upload</h1>
              <p>Upload your photo for a PawprintsCA artist to work on your portrait.</p>
            </div>
          </div>

          <div className="uploadQuickTips" role="note" aria-label="Upload tips">
            <span className="uploadQuickTip">Clear face</span>
            <span className="uploadQuickTip">Good light</span>
            <span className="uploadQuickTip">Exact pet name</span>
            {totalSlots > 1 ? (
              <span className="uploadQuickTip">
                {receivedCount}/{totalSlots} received
              </span>
            ) : null}
          </div>
        </div>

        <div className="uploadFlow">
          <div className={`uploadWorkGrid${hasCompletedAllUploads || isDelivered ? " uploadWorkGridSuccess" : ""}`}>
            <section className="uploadFormCard">
              {isDelivered ? (
                <div className="uploadSuccessBanner" role="status">
                  Portrait complete. Your delivery is ready for download.
                </div>
              ) : null}

              <div className="uploadSectionHeader">
                <div>
                  {hasCompletedAllUploads || isDelivered ? null : <div className="eyebrow">Upload details</div>}
                  <h2>
                    {hasCompletedAllUploads && !isDelivered
                      ? "Uploads Successful!"
                      : nextOpenSlot && totalSlots > 1
                      ? `Upload portrait ${nextOpenSlot.slotNumber} of ${totalSlots}`
                      : "Upload portrait reference"}
                  </h2>
                </div>
                {accentCopy ? <p>{accentCopy}</p> : null}
              </div>

              {isDelivered && finalImageUrl ? (
                <div className="stack">
                  {order.finalArtifacts.map((artifact, index) => (
                    <a
                      key={artifact.id}
                      className="button"
                      href={`/api/files/final/${token}?artifactId=${artifact.id}`}
                      download
                    >
                      {order.finalArtifacts.length > 1
                        ? `Save final portrait ${index + 1}`
                        : "Save final portrait"}
                    </a>
                  ))}
                </div>
              ) : isDelivered ? (
                <div className="uploadLockedMessage">
                  Your portrait is ready. If your save button does not appear, please refresh
                  this page.
                </div>
              ) : hasCompletedAllUploads ? (
                <div className="uploadLockedMessage">
                  We've received your order. Sit back and relax.
                </div>
              ) : nextOpenSlot ? (
                <UploadForm
                  token={token}
                  portraitSlotId={nextOpenSlot.id}
                  slotNumber={nextOpenSlot.slotNumber}
                  totalSlots={totalSlots}
                />
              ) : (
                <div className="uploadLockedMessage">Upload details are temporarily unavailable.</div>
              )}
            </section>

            <section className="uploadPortraitCard">
              <div className="uploadPortraitFrame">
                {isDelivered && finalImageUrl ? (
                  <img alt="Final pet portrait" src={finalImageUrl} />
                ) : (
                  <img
                    alt="Artist sketching a pet portrait"
                    src="/brand/pawprintsdrawing2.png"
                  />
                )}

                <div className="uploadFloatingMeta">
                  <span>
                    {isDelivered ? "Ready to save" : hasCompletedAllUploads ? "Under review" : "Upload pending"}
                  </span>
                </div>
              </div>

              <div className="uploadPortraitBody">
                <div className="eyebrow">
                  {isDelivered ? "Delivery ready" : hasCompletedAllUploads ? "Artist review" : "Upload status"}
                </div>

                {isDelivered ? (
                  <>
                    <h3>Your portrait is ready.</h3>
                    <p>Your final portrait has been completed and is ready to open.</p>
                  </>
                ) : hasCompletedAllUploads ? (
                  <>
                    <h3>Under review</h3>
                    <p>
                      Our artist is now working on your pet portrait. We&apos;ll update this page
                      when the review step is complete, and you can expect to hear back from us
                      within 24 hours.
                    </p>
                  </>
                ) : (
                  <>
                    <h3>What makes a strong upload</h3>
                    <p>
                      Use one clear pet photo for each portrait with good light, visible facial
                      detail, and minimal blur.
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
