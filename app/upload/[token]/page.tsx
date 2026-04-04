import { notFound } from "next/navigation";
import { UploadForm } from "@/app/upload/[token]/upload-form";

export default async function UploadPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{
    success?: string;
    delivered?: string;
    download?: string;
    underReview?: string;
  }>;
}) {
  const { token } = await params;
  const query = (await searchParams) ?? {};
  if (!token) {
    notFound();
  }

  const hasUploadedPhoto = query.success === "1" || query.underReview === "1";
  const isDelivered = query.delivered === "1";
  const deliveryHref = query.download ? `/download/${query.download}` : null;
  const accentCopy = isDelivered
    ? "Your portrait is finished and ready for delivery."
    : hasUploadedPhoto
    ? "Photo received. Your artist is now working on the portrait."
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
            <span className="uploadOrderMeta">Customer upload link</span>
          </div>
        </header>

        <div className="uploadIntro">
          <div className="uploadHero">
            <div className="uploadHeroCopy">
              <h1>Upload your pet photo.</h1>
              <p>Submit one clear image and the exact pet name for your portrait.</p>
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
              {isDelivered ? (
                <div className="uploadSuccessBanner" role="status">
                  Portrait complete. Your delivery is ready.
                </div>
              ) : query.success === "1" || hasUploadedPhoto ? (
                <div className="uploadSuccessBanner" role="status">
                  Photo received. Your portrait is now under artist review.
                </div>
              ) : null}

              <div className="uploadSectionHeader">
                <div>
                  <div className="eyebrow">Upload details</div>
                  <h2>Upload portrait reference</h2>
                </div>
                <p>{accentCopy}</p>
              </div>

              {isDelivered && deliveryHref ? (
                <a className="button" href={deliveryHref}>
                  Open final portrait
                </a>
              ) : isDelivered ? (
                <div className="uploadLockedMessage">
                  Your portrait is ready. Use your delivery link from email/message to open
                  the final files.
                </div>
              ) : hasUploadedPhoto ? (
                <div className="uploadLockedMessage">
                  Upload is complete for this order. The artist is currently working on your
                  portrait.
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
                <div className="eyebrow">
                  {isDelivered ? "Delivery ready" : hasUploadedPhoto ? "Artist review" : "Upload status"}
                </div>

                {isDelivered ? (
                  <>
                    <h3>Your portrait is ready.</h3>
                    <p>Your final portrait has been completed and is ready to open.</p>
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
