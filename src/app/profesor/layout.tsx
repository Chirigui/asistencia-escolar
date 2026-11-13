import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireStaff();
  if (!auth.ok) redirect("/login");
  return children;
}
