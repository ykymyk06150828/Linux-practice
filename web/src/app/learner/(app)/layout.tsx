import { LearnerSubNav } from "@/components/LearnerSubNav";
import { RequireAuth } from "@/components/RequireAuth";
import type { UserRole } from "@/types/api";

/** useEffect の依存が毎レンダーで変わらないようモジュール定数にする */
const ROLES_LEARNER_AND_ADMIN: UserRole[] = ["learner", "admin"];

export default function LearnerAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAuth roles={ROLES_LEARNER_AND_ADMIN}>
      {/* min-h-dvh だと子の高さに合わせて伸び、ページ全体がスクロールする。h-dvh + overflow でビューポート内に閉じる */}
      <div className="flex h-dvh max-h-dvh flex-col overflow-hidden">
        <LearnerSubNav />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </RequireAuth>
  );
}
