"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PasswordField } from "@/components/PasswordField";
import { api, ApiError } from "@/lib/api";
import type { LoginResponse } from "@/types/api";

export default function LoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ login_id: loginId, password }),
      });
      if (!data) return;
      if (data.user.role === "admin") {
        router.replace("/admin");
        return;
      }
      router.replace("/learner");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : "ログインに失敗しました";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-lg">
        <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
          共通
        </p>
        <h1 className="mt-1 text-2xl font-semibold">ログイン</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          受講者・管理者ともにこちらからログインしてください。ログイン後、権限に応じた画面へ移動します。
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="login_id" className="block text-sm text-[var(--muted)]">
              ログイン ID
            </label>
            <input
              id="login_id"
              name="login_id"
              autoComplete="username"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm text-[var(--muted)]">
              パスワード
            </label>
            <PasswordField
              id="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p className="text-sm text-[var(--danger)]" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[var(--accent)] py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {loading ? "処理中…" : "ログイン"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-[var(--muted)]">
          <Link href="/" className="text-[var(--accent)] hover:underline">
            トップへ戻る
          </Link>
        </p>
      </div>
    </main>
  );
}
