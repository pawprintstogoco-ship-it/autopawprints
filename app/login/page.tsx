import { isLocalAdminLoginConfigured } from "@/lib/auth";
import { requireEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const query = (await searchParams) ?? {};
  const error = query.error ?? "";
  requireEnv();
  const localLoginConfigured = isLocalAdminLoginConfigured();

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

          <a className="button" href="/api/admin/oauth/google">
            Sign in with Google
          </a>

          {localLoginConfigured ? (
            <form className="stack" action="/api/admin/login" method="post">
              <label className="field">
                <span>Email</span>
                <input name="email" type="email" autoComplete="email" required />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <button className="buttonSecondary" type="submit">
                Sign in with password
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
    case "local_config":
      return "Password login is not configured. Please use Google sign-in.";
    case "local_credentials":
      return "Those admin credentials did not work.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
