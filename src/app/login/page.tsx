import { ScottishLogo } from "@/components/ScottishLogo";
import { safeNextPath } from "@/lib/auth/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const error = params.error;

  return (
    <main className="login">
      <ScottishLogo markSize={64} />
      <h1>Commission calculator</h1>
      <p className="lede">Sign in to look up a job and calculate commission.</p>
      {error === "1" ? (
        <p className="login-error" role="alert">
          That username or password is not recognized.
        </p>
      ) : null}
      {error === "config" ? (
        <p className="login-error" role="alert">
          Sign-in is not configured. Set AUTH_SECRET to a long random value.
        </p>
      ) : null}
      <form className="login-form" method="post" action="/api/login">
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" name="username" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <button className="login-submit" type="submit">
          Sign in
        </button>
      </form>
    </main>
  );
}
