"use client";

import { useEffect, useState } from "react";
import { ShellHeader } from "@/components/ShellHeader";
import { api, ApiError } from "@/lib/api";
import Link from "next/link";

export default function AdminDashboardPage() {
  const [name, setName] = useState("");
  const [userTotal, setUserTotal] = useState<number | null>(null);
  const [containerTotal, setContainerTotal] = useState<number | null>(null);
  const [courseTotal, setCourseTotal] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{ user: { user_name: string } }>("/api/auth/me");
        if (cancelled || !me) return;
        setName(me.user.user_name);
        const u = await api<{ total: number }>("/api/admin/users?limit=1");
        if (cancelled || u === undefined) return;
        setUserTotal(u.total);
        const c = await api<{ total: number }>("/api/admin/containers?limit=1");
        if (cancelled || c === undefined) return;
        setContainerTotal(c.total);
        const co = await api<{ total: number }>("/api/admin/courses/count");
        if (cancelled || co === undefined) return;
        setCourseTotal(co.total);
      } catch (e) {
        if (!cancelled && e instanceof ApiError) setErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <ShellHeader
        title="管理者ダッシュボード"
        userName={name}
        showLogout={false}
      />
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        {err ? <p className="text-sm text-[var(--danger)]">{err}</p> : null}
        <p className="text-[var(--muted)]">
          受講状況・コンテナの概要です（API が利用可能なときに数値が表示されます）。
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
            <p className="text-sm text-[var(--muted)]">ユーザー（件数）</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {userTotal ?? "—"}
            </p>
            <Link
              href="/admin/users"
              className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline"
            >
              一覧へ
            </Link>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
            <p className="text-sm text-[var(--muted)]">コンテナ（件数）</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {containerTotal ?? "—"}
            </p>
            <Link
              href="/admin/containers"
              className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline"
            >
              一覧へ
            </Link>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
            <p className="text-sm text-[var(--muted)]">コース（件数）</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {courseTotal ?? "—"}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              一覧・追加・課題の確認
            </p>
            <Link
              href="/admin/courses"
              className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline"
            >
              一覧へ
            </Link>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
            <p className="text-sm text-[var(--muted)]">ログ</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              監査・操作ログを参照します。
            </p>
            <Link
              href="/admin/logs"
              className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline"
            >
              閲覧へ
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
