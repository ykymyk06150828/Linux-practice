"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShellHeader } from "@/components/ShellHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api, ApiError } from "@/lib/api";

const STORAGE_KEY = "learnerActiveCourseId";

type Course = {
  id: string;
  course_name: string;
  description: string;
  task_total: number;
  task_completed: number;
};

function courseStatusLabel(c: Course): string {
  if (c.task_total === 0) return "課題なし";
  if (c.task_completed === 0) return "未着手";
  if (c.task_completed >= c.task_total) return "完了";
  return "進行中";
}

/** 学習ステータス（画像2のように色分けしたバッジ） */
function LearnerCourseStatusBadge({ course: c }: { course: Course }) {
  const label = courseStatusLabel(c);
  let cls: string;
  if (c.task_total === 0) {
    cls =
      "border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted)]";
  } else if (c.task_completed === 0) {
    cls =
      "border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text)]";
  } else if (c.task_completed >= c.task_total) {
    cls =
      "border border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--success)]";
  } else {
    cls =
      "border border-[var(--accent)]/35 bg-[var(--accent)]/12 text-[var(--accent)]";
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

function primaryActionLabel(c: Course): string {
  if (c.task_total === 0) return "詳細を見る";
  return c.task_completed === 0 ? "コースを開始する" : "続きから学習";
}

export default function LearnerTopPage() {
  const [userName, setUserName] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{ user: { user_name: string } }>("/api/auth/me");
        if (cancelled || !me) return;
        setUserName(me.user.user_name);
        const cur = await api<{
          courses: Course[];
          course: Course | null;
        }>("/api/course/current");
        if (cancelled || !cur) return;
        setCourses(cur.courses ?? []);
      } catch (e) {
        if (!cancelled && e instanceof ApiError) setErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function rememberCourse(courseId: string) {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(STORAGE_KEY, courseId);
    }
  }

  async function doReset() {
    if (resetPending) return;
    setResetPending(true);
    setErr(null);
    try {
      await api("/api/environment/reset", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setResetOpen(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "リセットに失敗しました");
    } finally {
      setResetPending(false);
    }
  }

  const subtitle =
    courses.length === 0
      ? "コースを選んでください"
      : `${courses.length} 件のコース`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0">
        <ShellHeader
          title="受講者トップ"
          subtitle={subtitle}
          userName={userName}
          showLogout={false}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-5xl space-y-10 px-4 py-10 sm:px-6">
        {err ? (
          <p className="text-sm text-[var(--danger)]" role="alert">
            {err}
          </p>
        ) : null}
        <section>
          <h2 className="text-xl font-semibold tracking-tight text-[var(--text)]">
            マイコース
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            コースカードから詳細・課題一覧へ進み、演習を開始できます。
          </p>
          {courses.length === 0 ? (
            <p className="mt-8 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center text-[var(--muted)]">
              コースが未登録です。
            </p>
          ) : (
            <ul className="mt-8 grid gap-6 sm:grid-cols-2">
              {courses.map((c) => {
                const progressPercent =
                  c.task_total > 0
                    ? Math.min(
                        100,
                        Math.round((c.task_completed / c.task_total) * 100),
                      )
                    : null;
                const primaryHref =
                  c.task_total > 0
                    ? `/learner/terminal?courseId=${encodeURIComponent(c.id)}`
                    : `/learner/course/${encodeURIComponent(c.id)}`;
                return (
                  <li key={c.id}>
                    <div className="flex h-full flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm transition hover:border-[var(--accent)]/35 hover:shadow-md">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-lg font-semibold text-[var(--text)]">
                          {c.course_name}
                        </p>
                        <LearnerCourseStatusBadge course={c} />
                      </div>
                      {c.description ? (
                        <p className="mt-3 line-clamp-3 flex-1 text-sm leading-relaxed text-[var(--muted)]">
                          {c.description}
                        </p>
                      ) : (
                        <p className="mt-3 flex-1 text-sm text-[var(--muted)]">
                          （説明なし）
                        </p>
                      )}
                      <div className="mt-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                          <span className="font-medium text-[var(--text)]">
                            進捗
                          </span>
                          {c.task_total > 0 && progressPercent !== null ? (
                            <p className="tabular-nums text-[var(--text)]">
                              <span className="font-semibold">
                                {c.task_completed}
                              </span>
                              <span className="text-[var(--muted)]"> / </span>
                              <span className="text-[var(--muted)]">
                                {c.task_total}
                              </span>
                              <span className="ml-2 font-medium text-[var(--accent)]">
                                {progressPercent}%
                              </span>
                            </p>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )}
                        </div>
                        {c.task_total > 0 && progressPercent !== null ? (
                          <div
                            className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]"
                            role="progressbar"
                            aria-valuenow={progressPercent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`進捗 ${c.task_completed} 件完了、全 ${c.task_total} 件中`}
                          >
                            <div
                              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ease-out"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-6 flex flex-wrap gap-3">
                        <Link
                          href={primaryHref}
                          onClick={() => rememberCourse(c.id)}
                          className="inline-flex items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)]"
                        >
                          {primaryActionLabel(c)}
                        </Link>
                        <Link
                          href={`/learner/course/${encodeURIComponent(c.id)}`}
                          className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] shadow-sm hover:bg-[var(--surface-muted)]"
                        >
                          詳細・課題一覧
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm"
          aria-labelledby="learner-env-reset-heading"
        >
          <h3
            id="learner-env-reset-heading"
            className="text-base font-semibold tracking-tight text-[var(--text)]"
          >
            演習環境
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            コンテナの作業内容を初期状態に戻します。誤操作時のみご利用ください。
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setResetOpen(true)}
              className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] shadow-sm transition hover:bg-[var(--surface-muted)]"
            >
              環境リセット
            </button>
          </div>
        </section>
        </div>
      </div>
      <ConfirmDialog
        open={resetOpen}
        title="環境リセット"
        message={
          "現在の作業内容は失われます。コンテナを初期状態に戻しますか？"
        }
        confirmLabel="リセットする"
        danger
        pending={resetPending}
        pendingLabel="リセット処理中…"
        onConfirm={() => void doReset()}
        onCancel={() => {
          if (resetPending) return;
          setResetOpen(false);
        }}
      />
    </div>
  );
}
