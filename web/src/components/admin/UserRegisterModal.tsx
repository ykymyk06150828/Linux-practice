"use client";

import { useEffect, useState } from "react";
import { PasswordField } from "@/components/PasswordField";
import { api, ApiError } from "@/lib/api";
import type { UserRole } from "@/types/api";

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
};

export function UserRegisterModal({ open, onClose, onSuccess }: Props) {
  const [loginId, setLoginId] = useState("");
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("learner");
  const [courseIds, setCourseIds] = useState<Set<string>>(new Set());
  const [courses, setCourses] = useState<
    { id: string; course_name: string; status: string }[]
  >([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoginId("");
    setUserName("");
    setPassword("");
    setRole("learner");
    setCourseIds(new Set());
    setErr(null);
    setLoading(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const clist = await api<{
          courses: { id: string; course_name: string; status: string }[];
        }>("/api/admin/courses");
        if (cancelled || !clist) return;
        setCourses(clist.courses);
      } catch {
        if (!cancelled) setErr("コース一覧の取得に失敗しました");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function closeModal() {
    if (loading) return;
    onClose();
  }

  function toggleCourse(id: string) {
    setCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        login_id: loginId,
        user_name: userName,
        password,
        role,
      };
      if (role === "learner") {
        const ids = [...courseIds];
        if (ids.length > 0) {
          payload.course_ids = ids;
        }
      }
      await api("/api/admin/users/register", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await onSuccess();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "登録に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const activeCourses = courses.filter((c) => c.status === "active");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-user-register-title"
      onClick={closeModal}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="modal-user-register-title"
              className="text-lg font-semibold text-[var(--foreground)]"
            >
              ユーザーを登録
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              新しい受講者または管理者アカウントを登録します。パスワードは 8 文字以上です。
            </p>
          </div>
          <button
            type="button"
            aria-label="閉じる"
            disabled={loading}
            onClick={closeModal}
            className="shrink-0 rounded-md p-1.5 text-xl leading-none text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="modal-login_id" className="block text-sm text-[var(--muted)]">
              ログイン ID
            </label>
            <input
              id="modal-login_id"
              name="login_id"
              autoComplete="username"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              required
              maxLength={64}
            />
          </div>
          <div>
            <label htmlFor="modal-user_name" className="block text-sm text-[var(--muted)]">
              表示名
            </label>
            <input
              id="modal-user_name"
              name="user_name"
              autoComplete="name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              required
              maxLength={200}
            />
          </div>
          <div>
            <label htmlFor="modal-reg_password" className="block text-sm text-[var(--muted)]">
              パスワード（8 文字以上）
            </label>
            <PasswordField
              id="modal-reg_password"
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div>
            <label htmlFor="modal-role" className="block text-sm text-[var(--muted)]">
              ロール
            </label>
            <select
              id="modal-role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as UserRole);
                if (e.target.value !== "learner") setCourseIds(new Set());
              }}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            >
              <option value="learner">受講者（learner）</option>
              <option value="admin">管理者（admin）</option>
            </select>
          </div>
          {role === "learner" ? (
            <div>
              <p className="block text-sm text-[var(--muted)]">受講コース（任意・複数可）</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                未選択の場合は、有効なコースのうち最も古い 1 件に自動紐付けします。
              </p>
              <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
                {activeCourses.map((c) => (
                  <li key={c.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id={`modal-reg-co-${c.id}`}
                      checked={courseIds.has(c.id)}
                      onChange={() => toggleCourse(c.id)}
                      className="mt-1"
                    />
                    <label
                      htmlFor={`modal-reg-co-${c.id}`}
                      className="cursor-pointer text-sm"
                    >
                      {c.course_name}
                    </label>
                  </li>
                ))}
              </ul>
              {activeCourses.length === 0 ? (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  有効なコースがありません。後からユーザー詳細で紐付けできます。
                </p>
              ) : null}
            </div>
          ) : null}
          {err ? (
            <p className="text-sm text-[var(--danger)]" role="alert">
              {err}
            </p>
          ) : null}

          <div className="flex flex-col items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="min-w-[200px] rounded-lg bg-[var(--accent)] px-8 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "登録中…" : "登録"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={closeModal}
              className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] hover:underline disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
