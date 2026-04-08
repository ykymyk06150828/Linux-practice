"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { UserRole } from "@/types/api";
import { api, ApiError } from "@/lib/api";
import type { MeResponse } from "@/types/api";

type Props = {
  /** 単一ロール。`roles` より `roles` を優先 */
  role?: UserRole;
  /** いずれかのロールを許可（例: 受講者画面は管理者も可） */
  roles?: UserRole[];
  children: React.ReactNode;
};

function allowedRoles(role: UserRole | undefined, roles: UserRole[] | undefined): UserRole[] | null {
  if (roles && roles.length > 0) return roles;
  if (role) return [role];
  return null;
}

export function RequireAuth({ role, roles, children }: Props) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<MeResponse>("/api/auth/me");
        if (cancelled || !data) return;
        const allow = allowedRoles(role, roles);
        if (allow && !allow.includes(data.user.role)) {
          router.replace(data.user.role === "admin" ? "/admin" : "/learner");
          return;
        }
        setState("ok");
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/login");
          return;
        }
        setState("fail");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role, roles, router]);

  if (state === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-[var(--muted)]">
        読み込み中…
      </div>
    );
  }
  if (state === "fail") {
    return (
      <div className="p-8 text-center text-[var(--danger)]">
        認証情報の取得に失敗しました。
        <button
          type="button"
          className="mt-4 block w-full text-[var(--accent)] underline"
          onClick={() => router.push("/login")}
        >
          ログインへ
        </button>
      </div>
    );
  }
  return <>{children}</>;
}
