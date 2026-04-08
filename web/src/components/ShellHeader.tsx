"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
  title: string;
  subtitle?: string;
  userName?: string;
  showLogout?: boolean;
  /** 横いっぱいに広げる（ターミナル演習など） */
  fullWidth?: boolean;
};

export function ShellHeader({
  title,
  subtitle,
  userName,
  showLogout = true,
  fullWidth = false,
}: Props) {
  const router = useRouter();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);

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

  return (
    <>
      <header className="border-b border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div
          className={`mx-auto flex items-center justify-between gap-4 py-3 ${
            fullWidth
              ? "w-full max-w-none px-3 sm:px-4"
              : "max-w-6xl px-4"
          }`}
        >
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
              Linux コマンド研修
            </p>
            <h1 className="text-lg font-semibold">{title}</h1>
            {subtitle ? (
              <p className="text-sm text-[var(--muted)]">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-4">
            {userName ? (
              <span className="text-sm text-[var(--muted)]">{userName}</span>
            ) : null}
            {showLogout ? (
              <button
                type="button"
                onClick={() => setConfirmLogout(true)}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
              >
                ログアウト
              </button>
            ) : null}
          </div>
        </div>
      </header>
      <ConfirmDialog
        open={confirmLogout}
        title="ログアウト"
        message="ログアウトしますか？"
        confirmLabel="ログアウト"
        pending={logoutPending}
        pendingLabel="ログアウト処理中…"
        onConfirm={() => void logout()}
        onCancel={() => {
          if (logoutPending) return;
          setConfirmLogout(false);
        }}
      />
    </>
  );
}

function adminNavItemActive(pathname: string, href: string): boolean {
  const p = pathname.replace(/\/$/, "") || "/";
  const h = href.replace(/\/$/, "") || "/";
  if (h === "/admin") {
    return p === "/admin";
  }
  return p === h || p.startsWith(`${h}/`);
}

const ADMIN_NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/admin", label: "ダッシュボード" },
  { href: "/admin/courses", label: "コース" },
  { href: "/admin/users", label: "ユーザー" },
  { href: "/admin/containers", label: "コンテナ" },
  { href: "/admin/logs", label: "ログ" },
];

export function AdminNav() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const linkBase =
    "rounded-md px-3 py-2 text-sm transition-colors hover:bg-[var(--surface-muted)]";
  const linkInactive = `${linkBase} text-[var(--muted)] hover:text-[var(--text)]`;
  const linkActive = `${linkBase} border border-[var(--accent)]/40 bg-[var(--accent)]/15 font-medium text-[var(--accent)]`;

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

  return (
    <nav
      className="border-b border-[var(--border)] bg-[var(--surface-muted)]"
      aria-label="管理者メニュー"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-2">
        {ADMIN_NAV_ITEMS.map(({ href, label }) => {
          const active = adminNavItemActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={active ? linkActive : linkInactive}
              aria-current={active ? "page" : undefined}
            >
              {label}
            </Link>
          );
        })}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link
            href="/learner"
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--accent)] hover:bg-[var(--surface-muted)]"
          >
            研修（受講者）
          </Link>
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
