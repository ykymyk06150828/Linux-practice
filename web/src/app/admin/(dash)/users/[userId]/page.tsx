"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ShellHeader } from "@/components/ShellHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api, ApiError } from "@/lib/api";

type UserDetail = {
  user: {
    login_id: string;
    user_name: string;
    role: string;
    status: string;
  };
  enrollments: { course_id: string; course_name: string }[];
  assignment: {
    containerName?: string | null;
    containerId?: string | null;
    status?: string;
  } | null;
};

export default function AdminUserDetailPage() {
  const params = useParams();
  const userId = params.userId as string;
  const [adminName, setAdminName] = useState("");
  const [data, setData] = useState<UserDetail | null>(null);
  const [courses, setCourses] = useState<
    { id: string; course_name: string; status: string }[]
  >([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enrollSaving, setEnrollSaving] = useState(false);
  const [editUserName, setEditUserName] = useState("");
  const [editLoginId, setEditLoginId] = useState("");
  const [editRole, setEditRole] = useState<"learner" | "admin">("learner");
  const [profileSaving, setProfileSaving] = useState(false);
  /** 基本情報・受講コースの保存成功を同じ位置（説明文直下）に表示 */
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(
    null,
  );
  const [err, setErr] = useState<string | null>(null);
  const [actionOpen, setActionOpen] = useState<"reset" | "stop" | null>(null);
  const [actionPending, setActionPending] = useState(false);

  async function load() {
    setErr(null);
    try {
      const me = await api<{ user: { user_name: string } }>("/api/auth/me");
      setAdminName(me!.user.user_name);
      const [d, clist] = await Promise.all([
        api<UserDetail>(`/api/admin/users/${userId}`),
        api<{ courses: { id: string; course_name: string; status: string }[] }>(
          "/api/admin/courses",
        ),
      ]);
      setData(d ?? null);
      setCourses(clist?.courses ?? []);
      setSelectedIds(
        new Set((d?.enrollments ?? []).map((e) => e.course_id)),
      );
      if (d?.user) {
        setEditUserName(d.user.user_name);
        setEditLoginId(d.user.login_id);
        setEditRole(d.user.role === "admin" ? "admin" : "learner");
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "読み込みに失敗しました");
    }
  }

  useEffect(() => {
    void load();
  }, [userId]);

  useEffect(() => {
    if (!saveSuccessMessage) return;
    const t = window.setTimeout(() => setSaveSuccessMessage(null), 5000);
    return () => window.clearTimeout(t);
  }, [saveSuccessMessage]);

  async function saveProfile() {
    if (!data || profileSaving) return;
    setProfileSaving(true);
    setErr(null);
    setSaveSuccessMessage(null);
    try {
      await api(`/api/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          user_name: editUserName.trim(),
          login_id: editLoginId.trim(),
          role: editRole,
        }),
      });
      setSaveSuccessMessage("基本情報を保存しました。");
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "保存に失敗しました");
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveEnrollment() {
    if (data?.user.role !== "learner") return;
    setEnrollSaving(true);
    setErr(null);
    setSaveSuccessMessage(null);
    try {
      const body = { course_ids: [...selectedIds] };
      await api(`/api/admin/users/${userId}/enrollments`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setSaveSuccessMessage("受講コースを保存しました。");
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "保存に失敗しました");
    } finally {
      setEnrollSaving(false);
    }
  }

  function toggleCourse(courseId: string, status: string) {
    const c = courses.find((x) => x.id === courseId);
    if (!c) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (status === "active") {
        if (next.has(courseId)) next.delete(courseId);
        else next.add(courseId);
      } else if (status === "archived" && next.has(courseId)) {
        next.delete(courseId);
      }
      return next;
    });
  }

  async function doReset() {
    if (actionPending) return;
    setActionPending(true);
    setErr(null);
    try {
      await api("/api/admin/environment/reset", {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
      });
      setActionOpen(null);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "失敗しました");
    } finally {
      setActionPending(false);
    }
  }

  async function doStop() {
    if (actionPending) return;
    setActionPending(true);
    setErr(null);
    try {
      await api("/api/admin/environment/stop", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, action: "stop" }),
      });
      setActionOpen(null);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "失敗しました");
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div>
      <ShellHeader
        title="ユーザー詳細"
        userName={adminName}
        showLogout={false}
      />
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <Link href="/admin/users" className="text-sm text-[var(--accent)] hover:underline">
          ← 一覧へ
        </Link>
        {err ? (
          <p className="text-sm text-[var(--danger)]" role="alert">
            {err}
          </p>
        ) : null}
        {data ? (
          <>
            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
              <h2 className="text-lg font-semibold">基本情報</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                名前・ログイン ID・ロールを変更できます。ログイン ID はメール形式を想定しています（重複不可）。
              </p>
              {saveSuccessMessage ? (
                <div
                  className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-100"
                  role="status"
                  aria-live="polite"
                >
                  {saveSuccessMessage}
                </div>
              ) : null}
              <div className="mt-4 space-y-4">
                <div>
                  <label
                    htmlFor="detail-user_name"
                    className="block text-sm font-medium text-[var(--muted)]"
                  >
                    名前
                  </label>
                  <input
                    id="detail-user_name"
                    type="text"
                    value={editUserName}
                    onChange={(e) => setEditUserName(e.target.value)}
                    maxLength={200}
                    autoComplete="off"
                    className="mt-1 w-full max-w-md rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="detail-login_id"
                    className="block text-sm font-medium text-[var(--muted)]"
                  >
                    ログイン ID
                  </label>
                  <input
                    id="detail-login_id"
                    type="text"
                    inputMode="email"
                    value={editLoginId}
                    onChange={(e) => setEditLoginId(e.target.value)}
                    maxLength={64}
                    autoComplete="off"
                    className="mt-1 w-full max-w-md rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="detail-role"
                    className="block text-sm font-medium text-[var(--muted)]"
                  >
                    ロール
                  </label>
                  <select
                    id="detail-role"
                    value={editRole}
                    onChange={(e) =>
                      setEditRole(e.target.value === "admin" ? "admin" : "learner")
                    }
                    className="mt-1 w-full max-w-md rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  >
                    <option value="learner">受講者（learner）</option>
                    <option value="admin">管理者（admin）</option>
                  </select>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  アカウント状態:{" "}
                  <span className="text-[var(--foreground)]">
                    {data.user.status === "active" ? "有効" : "無効"}
                  </span>
                </p>
                <button
                  type="button"
                  disabled={
                    profileSaving ||
                    !editUserName.trim() ||
                    !editLoginId.trim()
                  }
                  onClick={() => void saveProfile()}
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {profileSaving ? "保存中…" : "基本情報を保存"}
                </button>
              </div>
              {data.user.role === "learner" ? (
                <div className="mt-8 border-t border-[var(--border)] pt-8">
                  <h3 className="text-sm font-medium">受講コース（複数選択可）</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    登録されているすべてのコースから選択します。受講者トップでは選択したコースごとに課題が表示されます。
                  </p>
                  <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    {courses.map((c) => {
                      const checked = selectedIds.has(c.id);
                      const disabled =
                        c.status === "archived" && !checked;
                      return (
                        <li key={c.id} className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            id={`co-${c.id}`}
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleCourse(c.id, c.status)}
                            className="mt-1"
                          />
                          <label
                            htmlFor={`co-${c.id}`}
                            className={`block flex-1 text-sm ${disabled ? "cursor-not-allowed text-[var(--muted)]" : "cursor-pointer"}`}
                          >
                            <span className="font-medium">{c.course_name}</span>
                            <span className="ml-2 text-xs text-[var(--muted)]">
                              {c.status === "active" ? "有効" : "アーカイブ"}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    アーカイブ済みコースは、既に紐付いている場合のみ解除できます（新規に紐付けはできません）。
                  </p>
                  <button
                    type="button"
                    disabled={enrollSaving}
                    onClick={() => void saveEnrollment()}
                    className="mt-4 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                  >
                    {enrollSaving ? "保存中…" : "保存"}
                  </button>
                </div>
              ) : null}
              <p className="mt-8 border-t border-[var(--border)] pt-6 text-sm">
                コンテナ:{" "}
                {data.assignment
                  ? `${data.assignment.containerName ?? data.assignment.containerId ?? "-"} (${data.assignment.status ?? "?"})`
                  : "なし"}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setActionOpen("reset")}
                  className="rounded-md border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--surface-muted)]"
                >
                  環境リセット
                </button>
                <button
                  type="button"
                  onClick={() => setActionOpen("stop")}
                  className="rounded-md border border-red-200 px-4 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger-bg)]"
                >
                  環境停止
                </button>
              </div>
            </section>
          </>
        ) : (
          !err && <p className="text-[var(--muted)]">読み込み中…</p>
        )}
      </div>
      <ConfirmDialog
        open={actionOpen === "reset"}
        title="環境リセット"
        message="この受講者の環境を初期化しますか？"
        confirmLabel="実行"
        pending={actionPending}
        pendingLabel="リセット処理中…"
        onConfirm={() => void doReset()}
        onCancel={() => {
          if (actionPending) return;
          setActionOpen(null);
        }}
      />
      <ConfirmDialog
        open={actionOpen === "stop"}
        title="環境停止"
        message="この受講者のコンテナを停止しますか？"
        confirmLabel="停止"
        danger
        pending={actionPending}
        pendingLabel="停止処理中…"
        onConfirm={() => void doStop()}
        onCancel={() => {
          if (actionPending) return;
          setActionOpen(null);
        }}
      />
    </div>
  );
}
