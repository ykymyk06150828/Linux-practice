"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ShellHeader } from "@/components/ShellHeader";
import { TaskDescriptionCollapsible } from "@/components/TaskDescriptionCollapsible";
import type { TerminalPaneHandle } from "@/components/TerminalPane";
import { api, ApiError } from "@/lib/api";

/** xterm はブラウザ専用（`self` 参照）。SSR / Node では読み込まない */
const TerminalPane = dynamic(
  () =>
    import("@/components/TerminalPane").then((mod) => mod.TerminalPane),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[12rem] w-full items-center justify-center rounded border border-[var(--border)] bg-[#0a0a0a] text-sm text-[var(--muted)]">
        ターミナルを読み込み中…
      </div>
    ),
  },
);

type Task = {
  id: string;
  task_name: string;
  description: string;
  display_order: number;
  completed?: boolean;
};

/** 初回表示: 未完了の先頭。全完了なら最後の課題 */
function pickInitialTaskIndex(tasks: Task[]): number {
  if (tasks.length === 0) return 0;
  const firstIncomplete = tasks.findIndex((t) => !t.completed);
  if (firstIncomplete >= 0) return firstIncomplete;
  return tasks.length - 1;
}

const STORAGE_KEY = "learnerActiveCourseId";

/** 固定フッターの下にコンテンツが隠れないよう確保する余白（フッター高さに合わせて調整） */
const FOOTER_RESERVE_CLASS = "pb-[min(9rem,calc(5.5rem+env(safe-area-inset-bottom)))]";

function LearnerTerminalInner() {
  const searchParams = useSearchParams();
  const paramCourseId = searchParams.get("courseId");

  const [userName, setUserName] = useState("");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [courseName, setCourseName] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskIndex, setTaskIndex] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [completeErr, setCompleteErr] = useState<string | null>(null);
  const [completePending, setCompletePending] = useState(false);
  const [terminalConnStatus, setTerminalConnStatus] = useState("");
  const terminalRef = useRef<TerminalPaneHandle | null>(null);

  const refreshTaskList = useCallback(async (cid: string): Promise<Task[]> => {
    const res = await api<{
      courses: { course_id: string; tasks: Task[] }[];
    }>(`/api/task/list?course_id=${encodeURIComponent(cid)}`);
    const block = res?.courses?.find((x) => x.course_id === cid);
    const list = block?.tasks ?? [];
    setTasks(list);
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadErr(null);
      try {
        const me = await api<{ user: { user_name: string } }>("/api/auth/me");
        if (cancelled || !me) return;
        setUserName(me.user.user_name);

        let cid =
          paramCourseId ||
          (typeof window !== "undefined"
            ? window.sessionStorage.getItem(STORAGE_KEY)
            : null);
        if (!cid) {
          setCourseId(null);
          setLoadErr("コースが選択されていません。コース一覧から選んでください。");
          return;
        }
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(STORAGE_KEY, cid);
        }
        setCourseId(cid);

        const cur = await api<{
          courses: { id: string; course_name: string }[];
        }>("/api/course/current");
        if (cancelled || !cur) return;
        const cmeta = (cur.courses ?? []).find((c) => c.id === cid);
        if (!cmeta) {
          setLoadErr("このコースは受講登録されていません。");
          setCourseId(null);
          return;
        }
        setCourseName(cmeta.course_name);

        const loadedTasks = await refreshTaskList(cid);
        if (cancelled) return;
        setTaskIndex(pickInitialTaskIndex(loadedTasks));
      } catch (e) {
        if (!cancelled && e instanceof ApiError) {
          setLoadErr(e.message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paramCourseId, refreshTaskList]);

  async function submitCompletion(taskId: string, complete: boolean) {
    if (!courseId || completePending) return;
    setCompleteErr(null);
    setCompletePending(true);
    try {
      await api(complete ? "/api/task/complete" : "/api/task/uncomplete", {
        method: "POST",
        body: JSON.stringify({ task_id: taskId }),
      });
      await refreshTaskList(courseId);
    } catch (e) {
      setCompleteErr(
        e instanceof ApiError
          ? e.message
          : complete
            ? "完了の記録に失敗しました"
            : "完了の取り消しに失敗しました",
      );
    } finally {
      setCompletePending(false);
    }
  }

  const currentTask = tasks.length > 0 ? tasks[taskIndex] : null;
  const taskCount = tasks.length;

  const backHref = courseId ? `/learner/course/${courseId}` : "/learner";

  const showFooterReconnect =
    terminalConnStatus === "切断" || terminalConnStatus === "接続エラー";

  if (loadErr) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ShellHeader
          title="ターミナル演習"
          subtitle="ターミナル"
          userName={userName}
          fullWidth
          showLogout={false}
        />
        <div className="flex flex-1 items-start justify-center overflow-y-auto p-3 sm:p-4">
          <p className="rounded-lg border border-amber-200 bg-[var(--warning-bg)] px-4 py-3 text-sm text-amber-900">
            {loadErr}{" "}
            <Link href="/learner" className="text-[var(--accent)] underline">
              受講者トップへ
            </Link>
          </p>
        </div>
      </div>
    );
  }

  if (!courseId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ShellHeader
          title="ターミナル演習"
          subtitle="ターミナル"
          userName={userName}
          fullWidth
          showLogout={false}
        />
        <div className="flex flex-1 items-center justify-center p-3 text-[var(--muted)] sm:p-4">
          読み込み中…
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${FOOTER_RESERVE_CLASS}`}
      >
        <div className="shrink-0">
          <ShellHeader
            title="ターミナル演習"
            subtitle={courseName ? `${courseName}` : "ターミナル"}
            userName={userName}
            fullWidth
            showLogout={false}
          />
        </div>

        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
            {/* 課題 | ターミナル：モバイルは縦積み。lg は左右分割（ターミナル側を広めに） */}
            <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(260px,38%)_minmax(0,1fr)] lg:grid-rows-1">
            {/* 左: 課題（タブ + 本文のみスクロール） */}
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-[var(--border)] lg:border-r">
              <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-muted)] px-2 py-2">
                <span className="shrink-0 pl-2 text-xs font-medium text-[var(--muted)]">
                  課題
                </span>
                <div className="hide-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
                  {tasks.length > 0 ? (
                    tasks.map((t, i) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTaskIndex(i)}
                        className={`flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                          i === taskIndex
                            ? "border border-[var(--accent)]/45 bg-[var(--accent)]/12 text-[var(--accent)] shadow-sm"
                            : "border border-transparent text-[var(--muted)] hover:bg-[var(--surface)]/90"
                        }`}
                      >
                        {t.completed ? (
                          <span
                            className="text-[var(--success)]"
                            aria-hidden
                          >
                            ✓
                          </span>
                        ) : null}
                        <span>課題 {i + 1}</span>
                      </button>
                    ))
                  ) : (
                    <span className="px-2 text-xs text-[var(--muted)]">
                      （課題なし）
                    </span>
                  )}
                </div>
              </div>
              <div className="h-0 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4 lg:px-5">
                {currentTask ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">
                        現在の課題（{taskIndex + 1} / {taskCount}）
                      </p>
                      {currentTask.completed ? (
                        <span className="rounded-md bg-[var(--success-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--success)]">
                          完了
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-[var(--text)]">
                      {currentTask.task_name}
                    </h2>
                    {currentTask.description ? (
                      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3 shadow-sm">
                        <TaskDescriptionCollapsible
                          key={currentTask.id}
                          text={currentTask.description}
                          collapsedMaxClass="max-h-32"
                        />
                      </div>
                    ) : null}
                    <div className="mt-6 border-t border-[var(--border)] pt-4">
                      {currentTask.completed ? (
                        <button
                          type="button"
                          disabled={completePending}
                          onClick={() =>
                            void submitCompletion(currentTask.id, false)
                          }
                          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] shadow-sm transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {completePending ? "処理中…" : "完了を取り消す"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={completePending}
                          onClick={() =>
                            void submitCompletion(currentTask.id, true)
                          }
                          className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {completePending
                            ? "記録中…"
                            : "この課題を完了にする"}
                        </button>
                      )}
                      <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
                        完了状態はマイコースの進捗に反映されます。
                      </p>
                      {completeErr ? (
                        <p
                          className="mt-2 text-sm text-[var(--danger)]"
                          role="alert"
                        >
                          {completeErr}
                        </p>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-[var(--muted)]">
                    このコースに課題がありません。コース設定を確認してください。
                  </p>
                )}
              </div>
            </div>

            {/* 右: ターミナル */}
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-[var(--border)] lg:border-t-0">
              <div className="flex shrink-0 items-center justify-start border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 sm:px-4">
                <span className="text-xs font-medium text-[var(--muted)]">
                  ターミナル
                </span>
              </div>
              <div className="flex h-0 min-h-0 flex-1 flex-col overflow-hidden px-1.5 pb-1.5 pt-0 sm:px-2 sm:pb-2">
                <TerminalPane
                  ref={terminalRef}
                  fill
                  showInlineReconnect={false}
                  onStatusChange={(s) => setTerminalConnStatus(s)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer
        className="fixed bottom-0 left-0 right-0 z-[100] flex min-h-[5.25rem] flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface)]/95 px-4 py-4 shadow-[0_-4px_24px_rgba(15,23,42,0.06)] backdrop-blur-md sm:min-h-[5.75rem] sm:gap-4 sm:px-6 sm:py-5"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <p
          className="min-w-0 max-w-[min(100%,28rem)] text-xs text-[var(--muted)] sm:text-sm"
          aria-live="polite"
        >
          <span className="font-medium text-[var(--text)]">接続状態: </span>
          {terminalConnStatus || "—"}
        </p>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3 sm:gap-4">
          {showFooterReconnect ? (
            <button
              type="button"
              onClick={() => terminalRef.current?.reconnect()}
              className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-2.5 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20 sm:px-5 sm:py-3"
            >
              再接続
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => terminalRef.current?.reconnect()}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] shadow-sm hover:bg-[var(--surface-muted)] sm:px-5 sm:py-3"
          >
            画面を更新
          </button>
          <Link
            href={backHref}
            className="rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] sm:px-5 sm:py-3"
          >
            課題一覧へ戻る
          </Link>
        </div>
      </footer>
    </div>
  );
}

export default function LearnerTerminalPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-[var(--muted)]">
          読み込み中…
        </div>
      }
    >
      <LearnerTerminalInner />
    </Suspense>
  );
}
