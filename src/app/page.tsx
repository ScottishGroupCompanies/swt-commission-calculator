import { Calculator } from "@/components/Calculator";
import { getCommissionDataSource } from "@/lib/data";

export default async function HomePage() {
  const snapshot = await getCommissionDataSource().loadSnapshot();
  return <Calculator snapshot={snapshot} />;
}
