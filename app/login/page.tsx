export default function LoginPage() {
  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <div className="brand">
            <div className="brand-mark">?</div>
            <div className="brand-copy">
              <div className="brand-title">Pet Sanctuary</div>
              <div className="brand-subtitle">Digital Portraits</div>
            </div>
          </div>
          <div className="avatar-chip" aria-hidden="true">
            ?
          </div>
        </div>
      </header>

      <main className="shell page-shell" style={{ maxWidth: 760 }}>
        <section className="hero hero-tight">
          <div className="eyebrow">Admin login</div>
          <h1>Access the Pet Sanctuary dashboard.</h1>
          <p>Sign in to review orders, portrait previews, Etsy sync, and delivery history.</p>
        </section>

        <section className="grid" style={{ gridTemplateColumns: "1fr", maxWidth: 560 }}>
          <article className="panel panel-pad stack">
            <div className="badge">Private operations portal</div>
            <form className="stack" action="/api/admin/login" method="post">
              <label className="field">
                <span>Email</span>
                <input type="email" name="email" required />
              </label>
              <label className="field">
                <span>Password</span>
                <input type="password" name="password" required />
              </label>
              <button className="button" type="submit">
                Sign in
              </button>
            </form>
          </article>
        </section>
      </main>
    </>
  );
}
