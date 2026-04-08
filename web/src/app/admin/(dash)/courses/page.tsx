"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ShellHeader } from "@/components/ShellHeader";
import { api, ApiError } from "@/lib/api";
import { copyToClipboard } from "@/lib/copyToClipboard";

type CourseRow = {
  id: string;
  course_name: string;
  description: string;
  status: string;
  task_count: number;
  enrollment_count: number;
  updated_at: string;
};

/** コピー（重なる二枚の紙）アイコン — Heroicons square-2-stack 相当の outline */
function CopyStackIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 8.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v8.25A2.25 2.25 0 0 0 6 16.5h2.25m7.5-8.25V18a2.25 2.25 0 0 0 2.25 2.25H18A2.25 2.25 0 0 0 21 18V9.75a2.25 2.25 0 0 0-2.25-2.25h-5.25z"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 12.75 9 18.75 19.5 5.25"
      />
    </svg>
  );
}

/** コース公開状態（有効 / アーカイブ）をバッジ表示 */
function AdminCourseStatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center rounded-full border border-[var(--success)]/25 bg-[var(--success-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--success)]">
        有効
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-amber-200/90 bg-[var(--warning-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--warning)]">
      アーカイブ
    </span>
  );
}

export default function AdminCoursesPage() {
  const [name, setName] = useState("");
  const [rows, setRows] = useState<CourseRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<CourseRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<"archive" | "restore" | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"active" | "archived">(
    "active",
  );
  const [copiedCourseId, setCopiedCourseId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    const data = await api<{ courses: CourseRow[]; total?: number }>(
      "/api/admin/courses",
    );
    if (data) setRows(data.courses);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{ user: { user_name: string } }>("/api/auth/me");
        if (cancelled || !me) return;
        setName(me.user.user_name);
        await loadRows();
      } catch (e) {
        if (!cancelled && e instanceof ApiError) setErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRows]);

  async function applyStatusChange() {
    if (!confirmRow || !confirmAction) return;
    setPending(true);
    setErr(null);
    try {
      await api(`/api/admin/courses/${confirmRow.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: confirmAction === "archive" ? "archived" : "active",
        }),
      });
      setConfirmRow(null);
      setConfirmAction(null);
      await loadRows();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "更新に失敗しました");
    } finally {
      setPending(false);
    }
  }

  const activeCount = rows.filter((r) => r.status === "active").length;
  const archivedCount = rows.filter((r) => r.status === "archived").length;
  const displayRows = rows.filter((r) =>
    statusFilter === "active"
      ? r.status === "active"
      : r.status === "archived",
  );

  async function copyCourseId(id: string) {
    const ok = await copyToClipboard(id);
    if (!ok) {
      setErr("クリップボードにコピーできませんでした");
      return;
    }
    setErr(null);
    setCopiedCourseId(id);
    window.setTimeout(() => {
      setCopiedCourseId((c) => (c === id ? null : c));
    }, 2000);
  }

  const filterBtn = (key: "active" | "archived", label: string) => (
    <button
      type="button"
      onClick={() => setStatusFilter(key)}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
        statusFilter === key
          ? "border border-[var(--accent)]/50 bg-[var(--accent)]/15 text-[var(--accent)]"
          : "border border-transparent text-[var(--muted)] hover:bg-[var(--surface-muted)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <ShellHeader
        title="コース一覧"
        userName={name}
        showLogout={false}
      />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-xl space-y-2 text-sm text-[var(--muted)]">
            <p>
              有効・アーカイブのコースはいずれもこの一覧で確認できます。アーカイブは受講者の演習から非表示になりますが、詳細画面で課題を閲覧できます。
            </p>
            <p>
              アーカイブしたコースは「有効化」でいつでも復元できます。
            </p>
          </div>
          <Link
            href="/admin/courses/new"
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            コースを追加
          </Link>
        </div>
        {err ? <p className="mb-4 text-sm text-[var(--danger)]">{err}</p> : null}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--muted)]">表示:</span>
          {filterBtn("active", `有効 (${activeCount})`)}
          {filterBtn("archived", `アーカイブ (${archivedCount})`)}
        </div>
        <p className="mb-6 text-xs text-[var(--muted)]">
          {statusFilter === "active" ? "有効なコース" : "アーカイブ済みコース"}を表示中{" "}
          {displayRows.length} 件 / 全 {rows.length} 件（有効 {activeCount} · アーカイブ{" "}
          {archivedCount}）
        </p>
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {displayRows.map((r) => (
            <li
              key={r.id}
              className="flex h-full min-h-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm transition hover:border-[var(--accent)]/25 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 text-lg font-semibold leading-snug text-[var(--text)]">
                  {r.course_name}
                </h3>
                <AdminCourseStatusBadge status={r.status} />
              </div>
              {r.description ? (
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[var(--muted)]">
                  {r.description}
                </p>
              ) : (
                <p className="mt-2 text-sm text-[var(--muted)]">（説明なし）</p>
              )}
              {/* 同一行のカードで高さが揃うよう、統計・ID・アクションを下寄せ */}
              <div className="mt-auto flex min-h-0 flex-col pt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-3 text-center">
                    <p className="text-xs font-medium text-[var(--muted)]">
                      課題数
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text)]">
                      {r.task_count}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-3 text-center">
                    <p className="text-xs font-medium text-[var(--muted)]">
                      受講登録
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text)]">
                      {r.enrollment_count}
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-xs font-medium text-[var(--muted)]">
                    コース ID
                  </p>
                  <div className="mt-1.5 flex items-stretch gap-2 rounded-lg border border-[var(--border)]/80 bg-[var(--surface-muted)]/80 px-3 py-2">
                    <code className="min-w-0 flex-1 self-center break-all text-xs leading-relaxed text-[var(--text)]/90">
                      {r.id}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyCourseId(r.id)}
                      title={
                        copiedCourseId === r.id
                          ? "コピーしました"
                          : "コース ID をコピー"
                      }
                      aria-label={
                        copiedCourseId === r.id
                          ? "コピーしました"
                          : "コース ID をコピー"
                      }
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)]/90 bg-[var(--surface-muted)] text-[var(--muted)] shadow-sm transition hover:bg-[var(--surface)] hover:text-[var(--text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/35"
                    >
                      {copiedCourseId === r.id ? (
                        <CheckIcon className="h-[1.125rem] w-[1.125rem] text-[var(--success)]" />
                      ) : (
                        <CopyStackIcon className="h-[1.125rem] w-[1.125rem]" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="mt-5 flex min-h-[2.75rem] gap-2">
                  <Link
                    href={`/admin/courses/${r.id}`}
                    className="flex min-w-0 flex-1 items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2.5 text-center text-sm font-medium text-white shadow-sm transition hover:bg-[var(--accent-hover)]"
                  >
                    詳細・課題編集
                  </Link>
                  {r.status === "active" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmRow(r);
                        setConfirmAction("archive");
                      }}
                      className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm font-medium text-[var(--text)] shadow-sm hover:bg-[var(--surface-muted)]"
                    >
                      アーカイブ
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmRow(r);
                        setConfirmAction("restore");
                      }}
                      className="shrink-0 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2.5 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20"
                    >
                      有効化
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {rows.length === 0 && !err ? (
          <p className="mt-6 text-sm text-[var(--muted)]">
            コースがありません。「コースを追加」から作成してください。
          </p>
        ) : null}
        {rows.length > 0 && displayRows.length === 0 && !err ? (
          <p className="mt-6 text-sm text-[var(--muted)]">
            この条件に一致するコースはありません。表示フィルタを変更してください。
          </p>
        ) : null}
      </div>
      <ConfirmDialog
        open={Boolean(confirmRow && confirmAction)}
        title={
          confirmAction === "archive"
            ? "コースをアーカイブ"
            : "コースを有効化"
        }
        message={
          confirmAction === "archive"
            ? `「${confirmRow?.course_name ?? ""}」をアーカイブしますか？受講者のコース一覧・演習からは表示されなくなります（受講登録自体は残ります）。`
            : `「${confirmRow?.course_name ?? ""}」を再度有効にしますか？受講者の画面に再表示されます。`
        }
        confirmLabel={confirmAction === "archive" ? "アーカイブ" : "有効化"}
        danger={confirmAction === "archive"}
        pending={pending}
        pendingLabel="処理中…"
        onConfirm={() => void applyStatusChange()}
        onCancel={() => {
          if (pending) return;
          setConfirmRow(null);
          setConfirmAction(null);
        }}
      />
    </div>
  );
}
