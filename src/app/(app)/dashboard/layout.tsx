import { requireAccess } from "@/lib/security/guard";

/** Server-side subscription gate for every dashboard page (verified email + eligible subscription). */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAccess();
  return children;
}
