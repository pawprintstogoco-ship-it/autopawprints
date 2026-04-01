export default function LoginPage() {
  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">Admin login</div>
        <h1>Access the PawPrints dashboard.</h1>
      </section>

      <section className="panel panel-pad" style={{ maxWidth: 520 }}>
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
      </section>
    </main>
  );
}
