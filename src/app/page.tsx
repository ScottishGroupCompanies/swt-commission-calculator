import { cookies } from "next/headers";
import { Calculator } from "@/components/Calculator";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getCommissionDataSource } from "@/lib/data";

export default async function HomePage() {
  const jar = await cookies();
  const session = readSession(jar.get(SESSION_COOKIE)?.value);
  const snapshot = await getCommissionDataSource().loadSnapshot();
  return <Calculator snapshot={snapshot} username={session?.username ?? ""} />;
}
