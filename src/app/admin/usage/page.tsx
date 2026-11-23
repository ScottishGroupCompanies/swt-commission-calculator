import { cookies } from "next/headers";
import { ScottishLogo } from "@/components/ScottishLogo";
import { isAdmin } from "@/lib/auth/access";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { readRecentUsage, type UsageEvent } from "@/lib/usage-log";

export const dynamic = "force-dynamic";

function cell(value: string | number | boolean | null | undefined): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function who(event: UsageEvent): string {
  if (event.kind === "login") return event.name || "—";
  return event.keyName || "—";
}

export default async function UsagePage() {
  const jar = await cookies();
  const session = readSession(jar.get(SESSION_COOKIE)?.value);
  if (!session || !isAdmin(session.username)) {
    return (
      <main className="login">
        <ScottishLogo height={64} />
        <h1>Admin only</h1>
        <p className="lede">Sign in as Kelly, Sarah, or Admin to view bot API usage.</p>
        <p>
          <a className="text-btn" href="/">
            Back to the calculator
          </a>
        </p>
      </main>
    );
  }

  const events = await readRecentUsage(100);

  return (
    <main className="wrap">
      <header className="mast">
        <div className="mast-top">
          <ScottishLogo />
          <a className="text-btn" href="/">
            Calculator
          </a>
        </div>
        <h1>API usage</h1>
        <p className="lede">
          Recent bot API calls and sign-in attempts, newest first. Keys and codes are not stored.
          The same lines are written to the Vercel runtime log.
        </p>
      </header>
      <section className="editor" aria-label="Recent usage">
        {events.length === 0 ? (
          <p className="waiting">No usage recorded yet.</p>
        ) : (
          <div className="usage-scroll">
            <table className="usage">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Kind</th>
                  <th>Who</th>
                  <th>Result</th>
                  <th>Path</th>
                  <th>Query</th>
                  <th>IP</th>
                  <th>User agent</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.ts}</td>
                    <td>{event.kind}</td>
                    <td>{who(event)}</td>
                    <td>
                      {event.kind === "login"
                        ? event.success
                          ? "signed in"
                          : "failed"
                        : cell(event.status)}
                    </td>
                    <td>{cell(event.path)}</td>
                    <td>{cell(event.query)}</td>
                    <td>{cell(event.ip)}</td>
                    <td>{cell(event.userAgent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
