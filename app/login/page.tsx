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
    case "oauth_only":
      return "Manual password login has been disabled. Please use Google sign-in.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
