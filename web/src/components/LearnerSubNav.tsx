"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api } from "@/lib/api";
import type { UserRole } from "@/types/api";

const linkBase =
  "rounded-md px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text)]";
const linkActive =
  "bg-[var(--accent)]/10 font-medium text-[var(--accent)]";

export function LearnerSubNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api<{ user: { role: UserRole } }>("/api/auth/me").then((d) => {
      if (!cancelled && d) setUserRole(d.user.role);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    setLogoutPending(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    } finally {
      setLogoutPending(false);
    }
    setConfirmLogout(false);
    router.push("/login");
    router.refresh();
  }

  const topActive =
    pathname === "/learner" || pathname.startsWith("/learner/course");

  return (
    <nav className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="flex w-full max-w-none flex-wrap items-center gap-1 px-3 py-2 sm:px-4">
        <Link
          href="/learner"
          className={`${linkBase} ${topActive ? linkActive : ""}`}
        >
          コース
        </Link>
        <Link
          href="/learner/terminal"
          className={`${linkBase} ${pathname === "/learner/terminal" ? linkActive : ""}`}
        >
          ターミナル
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {userRole === "admin" ? (
            <Link
              href="/admin"
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--accent)] hover:bg-[var(--surface-muted)]"
            >
              管理者メニュー
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setConfirmLogout(true)}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-muted)]"
          >
            ログアウト
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmLogout}
        title="ログアウト"
        message="ログアウトしますか？コンテナの紐付けが解除されます。"
        confirmLabel="ログアウト"
        pending={logoutPending}
        pendingLabel="ログアウト処理中…"
        onConfirm={() => void logout()}
        onCancel={() => {
          if (logoutPending) return;
          setConfirmLogout(false);
        }}
      />
    </nav>
  );
}
