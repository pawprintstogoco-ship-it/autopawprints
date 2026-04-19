import { requireEnv } from "@/lib/env";
import { isGoogleOAuthConfigured } from "@/lib/auth";

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const query = (await searchParams) ?? {};
  const error = query.error ?? "";
  const oauthEnabled = isGoogleOAuthConfigured();
  const { ADMIN_PASSWORD } = requireEnv();
  const showFallbackForm = Boolean(ADMIN_PASSWORD);

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">Admin login</div>
        <h1>Access the PawPrints dashboard.</h1>
      </section>

      <section className="panel panel-pad" style={{ maxWidth: 520 }}>
        <div className="stack">
          {error ? (
            <div className="errorBanner" role="alert">
              {getLoginErrorMessage(error)}
            </div>
          ) : null}

          {oauthEnabled ? (
            <a className="button" href="/api/admin/oauth/google">
              Sign in with Google
            </a>
          ) : (
            <div className="card stack">
              <strong>Google admin sign-in is not configured.</strong>
              <span className="muted">
                Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
                `GOOGLE_OAUTH_REDIRECT_URI` to enable OAuth.
              </span>
            </div>
          )}

          {showFallbackForm ? (
            <form className="stack" action="/api/admin/login" method="post">
              <div className="eyebrow">Emergency fallback</div>
              <label className="field">
                <span>Email</span>
                <input type="email" name="email" required />
              </label>
              <label className="field">
                <span>Password</span>
                <input type="password" name="password" required />
              </label>
              <button className="buttonSecondary" type="submit">
                Sign in with fallback password
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function getLoginErrorMessage(error: string) {
  switch (error) {
    case "oauth_config":
      return "Google admin sign-in is not configured yet.";
    case "oauth_state":
      return "That sign-in attempt expired. Please try again.";
    case "oauth_code":
      return "Google did not return a usable sign-in code. Please try again.";
    case "oauth_exchange":
      return "Google sign-in could not be completed. Please try again.";
    case "oauth_email":
      return "That Google account is not allowed to access the admin area.";
    case "session":
      return "We could not create your admin session. Please try again.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
