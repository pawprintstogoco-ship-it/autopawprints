import Link from "next/link";

export default function NotFound() {
  return (
    <main className="notFoundPage">
      <section className="notFoundPanel">
        <img
          className="notFoundLogo"
          src="/brand/pawprints-longform.svg"
          alt="PawPrints"
        />
        <div className="eyebrow">404</div>
        <h1>PawprintsCA page not found.</h1>
        <p>
          This link may be expired or typed incorrectly. Please use your latest
          upload link or return to the main site.
        </p>
        <div className="actions">
          <Link href="/" className="button">
            Go to home
          </Link>
          <Link href="/orders" className="buttonSecondary">
            Internal dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
