import { AdminNav } from "@/components/ShellHeader";
import { RequireAuth } from "@/components/RequireAuth";

export default function AdminDashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAuth role="admin">
      <div className="min-h-screen">
        <AdminNav />
        {children}
      </div>
    </RequireAuth>
  );
}
