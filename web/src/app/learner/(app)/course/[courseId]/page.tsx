"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ShellHeader } from "@/components/ShellHeader";
import { TaskDescriptionCollapsible } from "@/components/TaskDescriptionCollapsible";
import { api, ApiError } from "@/lib/api";

type Course = {
  id: string;
  course_name: string;
  description: string;
};

type Task = {
  id: string;
  task_name: string;
  description: string;
  display_order: number;
  completed?: boolean;
};

const STORAGE_KEY = "learnerActiveCourseId";

export default function LearnerCourseDetailPage() {
  const params = useParams();
  const courseId = params.courseId as string;
  const [userName, setUserName] = useState("");
  const [course, setCourse] = useState<Course | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
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
        }>("/api/course/current");
        if (cancelled || !cur) return;
        const c = (cur.courses ?? []).find((x) => x.id === courseId);
        if (!c) {
          setErr("このコースは受講登録されていないか、存在しません。");
          return;
        }
        setCourse(c);
        const t = await api<{
          courses: { course_id: string; tasks: Task[] }[];
          tasks: Task[];
        }>(`/api/task/list?course_id=${encodeURIComponent(courseId)}`);
        if (cancelled || !t) return;
        const block = t.courses?.find((x) => x.course_id === courseId);
        setTasks(block?.tasks ?? []);
      } catch (e) {
        if (!cancelled && e instanceof ApiError) setErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  function goTerminal() {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(STORAGE_KEY, courseId);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0">
        <ShellHeader
          title={course?.course_name ?? "コース"}
          subtitle="課題一覧"
          userName={userName}
          showLogout={false}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
        <Link
          href="/learner"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          ← コース一覧へ
        </Link>
        {err ? (
          <p className="text-sm text-[var(--danger)]" role="alert">
            {err}
          </p>
        ) : null}
        {!err && course ? (
          <>
            {course.description ? (
              <p className="text-sm text-[var(--muted)] whitespace-pre-wrap">
                {course.description}
              </p>
            ) : null}
            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-[var(--text)]">
                課題（タスク）
              </h2>
              {tasks.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--muted)]">
                  このコースには課題がまだありません。
                </p>
              ) : (
                <ol className="mt-5 space-y-4">
                  {tasks.map((t, i) => (
                    <li
                      key={t.id}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/35 p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">
                          課題 {i + 1}
                        </span>
                        {t.completed ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--success-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--success)]">
                            <span aria-hidden>✓</span>
                            完了
                          </span>
                        ) : null}
                      </div>
                      <h3 className="mt-2 text-base font-semibold text-[var(--text)]">
                        {t.task_name}
                      </h3>
                      {t.description ? (
                        <div className="mt-3 rounded-lg border border-[var(--border)]/80 bg-[var(--surface)] px-3 py-3 shadow-sm">
                          <TaskDescriptionCollapsible
                            text={t.description}
                            collapsedMaxClass="max-h-32"
                          />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <div className="flex flex-wrap gap-3">
              {tasks.length > 0 ? (
                <Link
                  href={`/learner/terminal?courseId=${encodeURIComponent(courseId)}`}
                  onClick={goTerminal}
                  className="rounded-md bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                >
                  演習開始
                </Link>
              ) : (
                <span className="rounded-md border border-[var(--border)] px-5 py-2.5 text-sm text-[var(--muted)]">
                  演習開始（課題登録後に利用できます）
                </span>
              )}
            </div>
          </>
        ) : !err ? (
          <p className="text-[var(--muted)]">読み込み中…</p>
        ) : null}
        </div>
      </div>
    </div>
  );
}
