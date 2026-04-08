"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ShellHeader } from "@/components/ShellHeader";
import { api, ApiError } from "@/lib/api";

type Task = {
  id: string;
  task_name: string;
  description: string;
  display_order: number;
};

type ProgressUserRow = {
  user_id: string;
  login_id: string;
  user_name: string;
  role: string;
  user_status: string;
  completed_count: number;
  total_tasks: number;
};

const BULK_TASK_MAX = 200;
/** 一括登録用 JSON ファイルの上限（バイト） */
const BULK_JSON_MAX_BYTES = 2 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function roleLabel(role: string): string {
  if (role === "admin") return "管理者";
  if (role === "learner") return "受講者";
  return role;
}

function statusLabel(s: string): string {
  if (s === "active") return "有効";
  if (s === "disabled") return "無効";
  return s;
}

/** 0–100。課題 0 件のときは null */
function userProgressPercent(u: ProgressUserRow): number | null {
  if (u.total_tasks <= 0) return null;
  return Math.min(
    100,
    Math.round((u.completed_count / u.total_tasks) * 100),
  );
}

function ProgressBarCell({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <span className="text-[var(--muted)]" title="課題が未登録のため算出できません">
        —
      </span>
    );
  }
  const w = Math.min(100, Math.max(0, pct));
  const fillClass =
    w >= 100
      ? "bg-emerald-600 dark:bg-emerald-500"
      : w <= 0
        ? "bg-[var(--border)]"
        : "bg-[var(--accent)]";
  return (
    <div className="flex min-w-[11rem] max-w-[220px] flex-col gap-1.5 sm:min-w-[13rem]">
      <div className="flex items-center gap-2">
        <div
          className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-muted)] ring-1 ring-[var(--border)]/60"
          role="progressbar"
          aria-valuenow={w}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`進捗 ${w}パーセント`}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${fillClass}`}
            style={{ width: `${w}%` }}
          />
        </div>
        <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-[var(--foreground)]">
          {w}%
        </span>
      </div>
    </div>
  );
}

function parseBulkTaskJson(text: string):
  | { ok: true; rows: { task_name: string; description: string | null }[] }
  | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: "JSON ファイルを選択してください" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      error: "JSON の解析に失敗しました。UTF-8 の有効な JSON か確認してください。",
    };
  }
  let arr: unknown[];
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { tasks?: unknown }).tasks)
  ) {
    arr = (parsed as { tasks: unknown[] }).tasks;
  } else {
    return {
      ok: false,
      error: 'トップレベルは配列、または { "tasks": [ ... ] } 形式にしてください。',
    };
  }
  if (arr.length === 0) return { ok: false, error: "tasks は 1 件以上必要です" };
  if (arr.length > BULK_TASK_MAX) {
    return { ok: false, error: `一度に登録できるのは最大 ${BULK_TASK_MAX} 件です` };
  }
  const out: { task_name: string; description: string | null }[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item || typeof item !== "object") {
      return { ok: false, error: `tasks[${i}] がオブジェクトではありません` };
    }
    const o = item as Record<string, unknown>;
    const rawName =
      typeof o.task_name === "string"
        ? o.task_name
        : typeof o.name === "string"
          ? o.name
          : "";
    const name = rawName.trim();
    if (!name || name.length > 200) {
      return {
        ok: false,
        error: `tasks[${i}]: task_name（または name）は 1〜200 文字で指定してください`,
      };
    }
    if ("description" in o) {
      const d = o.description;
      if (d === null || d === undefined) {
        out.push({ task_name: name, description: null });
        continue;
      }
      if (typeof d !== "string") {
        return { ok: false, error: `tasks[${i}]: description は文字列または null です` };
      }
      const ds = d.trim();
      if (ds.length > 4000) {
        return { ok: false, error: `tasks[${i}]: description は最大 4000 文字です` };
      }
      out.push({ task_name: name, description: ds.length ? ds : null });
    } else {
      out.push({ task_name: name, description: null });
    }
  }
  return { ok: true, rows: out };
}

export default function AdminCourseDetailPage() {
  const params = useParams();
  const courseId = params.courseId as string;
  const [name, setName] = useState("");
  const [courseName, setCourseName] = useState("");
  const [status, setStatus] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskOrder, setNewTaskOrder] = useState("");
  const [savingNew, setSavingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editOrder, setEditOrder] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [descExpanded, setDescExpanded] = useState<Record<string, boolean>>({});
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [bulkJsonPayload, setBulkJsonPayload] = useState("");
  const [bulkFileMeta, setBulkFileMeta] = useState<{
    name: string;
    size: number;
  } | null>(null);
  const [bulkDragActive, setBulkDragActive] = useState(false);
  const [bulkReadingFile, setBulkReadingFile] = useState(false);
  const [bulkSubmitProgress, setBulkSubmitProgress] = useState<number | null>(
    null,
  );
  const [bulkPending, setBulkPending] = useState(false);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const [modalAddOpen, setModalAddOpen] = useState(false);
  const [modalBulkOpen, setModalBulkOpen] = useState(false);
  /** 課題タブ内の一覧上部に表示（単体・一括登録の完了時） */
  const [taskListSuccess, setTaskListSuccess] = useState<string | null>(null);
  const [courseSaveSuccess, setCourseSaveSuccess] = useState(false);
  const [tab, setTab] = useState<"course" | "tasks" | "progress">("course");
  const [progressUsers, setProgressUsers] = useState<ProgressUserRow[]>([]);
  const [progressTaskCount, setProgressTaskCount] = useState(0);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressErr, setProgressErr] = useState<string | null>(null);
  const [courseNameDraft, setCourseNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [savingCourseInfo, setSavingCourseInfo] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    const data = await api<{
      course: {
        course_name: string;
        description: string;
        status: string;
      };
      tasks: Task[];
    }>(`/api/admin/courses/${courseId}`);
    if (!data) return;
    setCourseName(data.course.course_name);
    setCourseNameDraft(data.course.course_name);
    setDescriptionDraft(data.course.description ?? "");
    setStatus(data.course.status);
    setTasks(data.tasks);
  }, [courseId]);

  async function saveCourseInfo(e: React.FormEvent) {
    e.preventDefault();
    if (savingCourseInfo || status === "archived") return;
    const trimmedName = courseNameDraft.trim();
    if (!trimmedName) {
      setErr("コース名を入力してください");
      return;
    }
    setSavingCourseInfo(true);
    setErr(null);
    try {
      await api(`/api/admin/courses/${courseId}`, {
        method: "PATCH",
        body: JSON.stringify({
          course_name: trimmedName,
          description: descriptionDraft.trim() || null,
        }),
      });
      setCourseSaveSuccess(true);
      await load();
    } catch (err) {
      setErr(err instanceof ApiError ? err.message : "コース情報の保存に失敗しました");
    } finally {
      setSavingCourseInfo(false);
    }
  }

  const loadProgress = useCallback(async () => {
    setProgressLoading(true);
    setProgressErr(null);
    try {
      const data = await api<{
        task_count: number;
        users: ProgressUserRow[];
      }>(`/api/admin/courses/${courseId}/progress`);
      if (!data) return;
      setProgressTaskCount(data.task_count);
      setProgressUsers(data.users);
    } catch (e) {
      setProgressErr(e instanceof ApiError ? e.message : "進捗の取得に失敗しました");
      setProgressUsers([]);
    } finally {
      setProgressLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    if (tab !== "progress") return;
    void loadProgress();
  }, [tab, loadProgress]);

  useEffect(() => {
    if (tab !== "tasks") setTaskListSuccess(null);
  }, [tab]);

  const progressSummary = useMemo(() => {
    if (progressUsers.length === 0) return null;
    const withTasks = progressUsers.filter((u) => u.total_tasks > 0);
    if (withTasks.length === 0) return null;
    let sumPct = 0;
    let completedAll = 0;
    let inProgress = 0;
    let notStarted = 0;
    for (const u of withTasks) {
      const p = (u.completed_count / u.total_tasks) * 100;
      sumPct += p;
      if (u.completed_count >= u.total_tasks) completedAll += 1;
      else if (u.completed_count > 0) inProgress += 1;
      else notStarted += 1;
    }
    const avg = Math.round(sumPct / withTasks.length);
    return {
      avg,
      completedAll,
      inProgress,
      notStarted,
      enrolled: withTasks.length,
    };
  }, [progressUsers]);

  const isArchived = status === "archived";

  async function patchCourseStatus(next: "active" | "archived") {
    setStatusPending(true);
    setErr(null);
    try {
      await api(`/api/admin/courses/${courseId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      setArchiveOpen(false);
      setRestoreOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "更新に失敗しました");
    } finally {
      setStatusPending(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{ user: { user_name: string } }>("/api/auth/me");
        if (cancelled || !me) return;
        setName(me.user.user_name);
        await load();
      } catch (e) {
        if (!cancelled && e instanceof ApiError) setErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  function resetBulkImportFileState() {
    setBulkJsonPayload("");
    setBulkFileMeta(null);
    setBulkReadingFile(false);
    setBulkSubmitProgress(null);
    if (bulkFileInputRef.current) bulkFileInputRef.current.value = "";
  }

  function openBulkImportModal() {
    setErr(null);
    setTaskListSuccess(null);
    resetBulkImportFileState();
    setModalBulkOpen(true);
  }

  function ingestBulkJsonFile(file: File) {
    setErr(null);
    if (file.size > BULK_JSON_MAX_BYTES) {
      setErr(
        `ファイルサイズは最大 ${formatFileSize(BULK_JSON_MAX_BYTES)} までです（現在 ${formatFileSize(file.size)}）`,
      );
      return;
    }
    setBulkReadingFile(true);
    setBulkFileMeta({ name: file.name, size: file.size });
    const reader = new FileReader();
    reader.onload = () => {
      const t = typeof reader.result === "string" ? reader.result : "";
      setBulkJsonPayload(t);
      setBulkReadingFile(false);
    };
    reader.onerror = () => {
      setErr("ファイルの読み込みに失敗しました");
      setBulkReadingFile(false);
      setBulkFileMeta(null);
      setBulkJsonPayload("");
    };
    reader.readAsText(file, "UTF-8");
  }

  function onBulkJsonInputChange(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    ingestBulkJsonFile(file);
  }

  function removeBulkSelectedFile() {
    if (bulkPending || bulkReadingFile) return;
    resetBulkImportFileState();
  }

  function closeBulkImportModal() {
    if (bulkPending || bulkReadingFile) return;
    resetBulkImportFileState();
    setModalBulkOpen(false);
  }

  async function submitBulkJson(e: React.FormEvent) {
    e.preventDefault();
    if (bulkPending || bulkReadingFile || isArchived) return;
    const parsed = parseBulkTaskJson(bulkJsonPayload);
    if (!parsed.ok) {
      setErr(parsed.error);
      return;
    }
    setBulkPending(true);
    setErr(null);
    setBulkSubmitProgress(0);
    const tick = window.setInterval(() => {
      setBulkSubmitProgress((p) =>
        p === null ? 0 : Math.min(92, p + 9),
      );
    }, 200);
    try {
      const n = parsed.rows.length;
      await api(`/api/admin/courses/${courseId}/tasks/bulk`, {
        method: "POST",
        body: JSON.stringify({ tasks: parsed.rows }),
      });
      setBulkSubmitProgress(100);
      resetBulkImportFileState();
      setModalBulkOpen(false);
      setTaskListSuccess(`タスクを ${n} 件一括登録しました。`);
      await load();
    } catch (err) {
      setErr(err instanceof ApiError ? err.message : "一括登録に失敗しました");
    } finally {
      window.clearInterval(tick);
      setBulkSubmitProgress(null);
      setBulkPending(false);
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (savingNew || !newTaskName.trim()) return;
    setSavingNew(true);
    setErr(null);
    try {
      const order =
        newTaskOrder.trim() === ""
          ? undefined
          : Number.parseInt(newTaskOrder, 10);
      if (
        order !== undefined &&
        (Number.isNaN(order) || order < 1)
      ) {
        setErr("表示順は 1 以上の整数で指定してください");
        setSavingNew(false);
        return;
      }
      await api(`/api/admin/courses/${courseId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          task_name: newTaskName.trim(),
          description: newTaskDesc.trim() || null,
          ...(order !== undefined && !Number.isNaN(order)
            ? { display_order: order }
            : {}),
        }),
      });
      setNewTaskName("");
      setNewTaskDesc("");
      setNewTaskOrder("");
      setModalAddOpen(false);
      setTaskListSuccess("タスクを登録しました。");
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "追加に失敗しました");
    } finally {
      setSavingNew(false);
    }
  }

  function startEdit(t: Task) {
    setEditingId(t.id);
    setEditName(t.task_name);
    setEditDesc(t.description);
    setEditOrder(String(t.display_order));
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function deleteTask() {
    if (!deleteTaskId || deletePending) return;
    const tid = deleteTaskId;
    setDeletePending(true);
    setErr(null);
    try {
      await api(`/api/admin/tasks/${tid}`, { method: "DELETE" });
      setDeleteTaskId(null);
      if (editingId === tid) setEditingId(null);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "削除に失敗しました");
    } finally {
      setDeletePending(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || savingEdit || !editName.trim()) return;
    setSavingEdit(true);
    setErr(null);
    try {
      const order = Number.parseInt(editOrder, 10);
      if (Number.isNaN(order) || order < 1) {
        setErr("表示順は 1 以上の整数で指定してください");
        setSavingEdit(false);
        return;
      }
      await api(`/api/admin/tasks/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          task_name: editName.trim(),
          description: editDesc.trim() || null,
          display_order: order,
        }),
      });
      setEditingId(null);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "更新に失敗しました");
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div>
      <ShellHeader
        title={courseName || "コース詳細"}
        subtitle={
          status
            ? `状態: ${status === "archived" ? "アーカイブ" : "有効"}`
            : undefined
        }
        userName={name}
        showLogout={false}
      />
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <Link
          href="/admin/courses"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          ← コース一覧
        </Link>
        {err ? (
          <p className="text-sm text-[var(--danger)]" role="alert">
            {err}
          </p>
        ) : null}

        <div
          className="flex flex-wrap gap-1 border-b border-[var(--border)]"
          role="tablist"
          aria-label="コース詳細の表示切替"
        >
          <button
            type="button"
            role="tab"
            id="course-tab-course"
            aria-selected={tab === "course"}
            aria-controls="course-panel-course"
            className={`rounded-t-md px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === "course"
                ? "border border-b-0 border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
                : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            }`}
            onClick={() => setTab("course")}
          >
            コースの編集
          </button>
          <button
            type="button"
            role="tab"
            id="course-tab-tasks"
            aria-selected={tab === "tasks"}
            aria-controls="course-panel-tasks"
            className={`rounded-t-md px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === "tasks"
                ? "border border-b-0 border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
                : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            }`}
            onClick={() => setTab("tasks")}
          >
            タスクの登録・編集
          </button>
          <button
            type="button"
            role="tab"
            id="course-tab-progress"
            aria-selected={tab === "progress"}
            aria-controls="course-panel-progress"
            className={`rounded-t-md px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === "progress"
                ? "border border-b-0 border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
                : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            }`}
            onClick={() => setTab("progress")}
          >
            受講者の進捗
          </button>
        </div>

        {tab === "course" ? (
          <div
            id="course-panel-course"
            role="tabpanel"
            aria-labelledby="course-tab-course"
            className="space-y-8"
          >
        {isArchived ? (
          <div className="rounded-lg border border-amber-200 bg-[var(--warning-bg)] px-4 py-3 text-sm text-amber-900">
            このコースはアーカイブです。受講者のコース一覧・演習からは表示されません。課題の編集はできません。
          </div>
        ) : null}
        <form
          onSubmit={saveCourseInfo}
          className="space-y-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
        >
          {courseSaveSuccess ? (
            <div
              className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-100"
              role="status"
            >
              変更を保存しました。
            </div>
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">コース情報</h2>
            <div className="flex shrink-0 flex-wrap gap-2">
              {isArchived ? (
                <button
                  type="button"
                  onClick={() => setRestoreOpen(true)}
                  className="rounded-md border border-[var(--accent)]/50 bg-[var(--accent)]/15 px-3 py-2 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/25"
                >
                  有効化
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setArchiveOpen(true)}
                  className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-muted)]"
                >
                  アーカイブ
                </button>
              )}
            </div>
          </div>
          <div>
            <label htmlFor="course-name" className="block text-sm font-medium text-[var(--muted)]">
              コース名
            </label>
            <input
              id="course-name"
              type="text"
              value={courseNameDraft}
              onChange={(e) => {
                setCourseSaveSuccess(false);
                setCourseNameDraft(e.target.value);
              }}
              maxLength={200}
              required
              disabled={isArchived}
              className="mt-2 w-full max-w-xl rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="例: Linux 基礎"
            />
            <p className="mt-1 text-xs text-[var(--muted)]">最大 200 文字</p>
          </div>
          <div>
            <label htmlFor="course-desc" className="block text-sm font-medium text-[var(--muted)]">
              コース説明
            </label>
            <textarea
              id="course-desc"
              value={descriptionDraft}
              onChange={(e) => {
                setCourseSaveSuccess(false);
                setDescriptionDraft(e.target.value);
              }}
              rows={6}
              maxLength={4000}
              disabled={isArchived}
              className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="受講者向けの説明文（任意）"
            />
            <p className="mt-1 text-xs text-[var(--muted)]">最大 4000 文字。空欄にすると説明なしとして保存されます。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={savingCourseInfo || isArchived}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingCourseInfo ? "保存中…" : "変更を保存"}
            </button>
            {isArchived ? (
              <p className="self-center text-sm text-[var(--muted)]">
                アーカイブ中はコース名・説明を変更できません。有効化してから編集してください。
              </p>
            ) : null}
          </div>
        </form>
          </div>
        ) : tab === "tasks" ? (
          <div
            id="course-panel-tasks"
            role="tabpanel"
            aria-labelledby="course-tab-tasks"
            className="space-y-8"
          >
        {isArchived ? (
          <div className="rounded-lg border border-amber-200 bg-[var(--warning-bg)] px-4 py-3 text-sm text-amber-900">
            このコースはアーカイブです。受講者のコース一覧・演習からは表示されません。課題の編集はできません。
          </div>
        ) : null}
        <section>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">課題（タスク）</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                受講者トップの課題一覧に反映されます。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isArchived}
                onClick={() => {
                  setErr(null);
                  setTaskListSuccess(null);
                  setModalAddOpen(true);
                }}
                className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                タスクを登録
              </button>
              <button
                type="button"
                disabled={isArchived}
                onClick={openBulkImportModal}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                タスクを一括登録
              </button>
            </div>
          </div>
          {taskListSuccess ? (
            <div
              className="mb-6 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-100"
              role="status"
              aria-live="polite"
            >
              {taskListSuccess}
            </div>
          ) : null}
          <div className="space-y-3">
            {tasks.map((t) =>
              editingId === t.id ? (
                <form
                  key={t.id}
                  onSubmit={saveEdit}
                  className="rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-4"
                >
                  <div>
                    <label className="block text-xs text-[var(--muted)]">課題名</label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                      required
                    />
                  </div>
                  <div className="mt-2">
                    <label className="block text-xs text-[var(--muted)]">説明</label>
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      rows={3}
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                  <div className="mt-2">
                    <label className="block text-xs text-[var(--muted)]">
                      表示順（1 始まり。変更時も他の課題と入れ替えて重複しません）
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={editOrder}
                      onChange={(e) => setEditOrder(e.target.value)}
                      className="mt-1 w-32 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="submit"
                      disabled={savingEdit}
                      className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                    >
                      {savingEdit ? "保存中…" : "保存"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={savingEdit}
                      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
                    >
                      キャンセル
                    </button>
                  </div>
                </form>
              ) : (
                <div
                  key={t.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {t.display_order}. {t.task_name}
                      </p>
                      {t.description ? (
                        <div className="mt-2">
                          <p
                            className={`text-sm text-[var(--muted)] whitespace-pre-wrap ${
                              descExpanded[t.id] ? "" : "line-clamp-3"
                            }`}
                          >
                            {t.description}
                          </p>
                          {t.description.length > 160 ? (
                            <button
                              type="button"
                              className="mt-1 text-xs text-[var(--accent)] hover:underline"
                              onClick={() =>
                                setDescExpanded((prev) => ({
                                  ...prev,
                                  [t.id]: !prev[t.id],
                                }))
                              }
                            >
                              {descExpanded[t.id] ? "折りたたむ" : "続きを表示"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(t)}
                        disabled={isArchived}
                        className="rounded-md border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTaskId(t.id)}
                        disabled={isArchived}
                        className="rounded-md border border-red-200 px-3 py-1 text-sm text-[var(--danger)] hover:bg-[var(--danger-bg)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>
          {tasks.length === 0 && !err ? (
            <p className="mt-4 text-sm text-[var(--muted)]">
              このコースには課題がまだありません。上のフォームから追加してください。
            </p>
          ) : null}
        </section>
          </div>
        ) : (
          <section
            id="course-panel-progress"
            role="tabpanel"
            aria-labelledby="course-tab-progress"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
          >
            <h2 className="text-lg font-semibold">受講者の進捗</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              このコースに受講登録されているユーザーごとに、完了した課題数を表示します（全{" "}
              {progressTaskCount} 課題）。
            </p>
            {progressErr ? (
              <p className="mt-4 text-sm text-[var(--danger)]" role="alert">
                {progressErr}
              </p>
            ) : null}
            {progressLoading ? (
              <p className="mt-6 text-sm text-[var(--muted)]">読み込み中…</p>
            ) : (
              <div className="mt-6 space-y-6">
                {progressTaskCount === 0 && progressUsers.length > 0 ? (
                  <p className="rounded-lg border border-amber-200 bg-[var(--warning-bg)] px-4 py-3 text-sm text-amber-950">
                    このコースにはまだ課題がないため、進捗率は表示できません。先に「タスクの登録・編集」タブで課題を追加してください。
                  </p>
                ) : null}
                {progressSummary && progressTaskCount > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/40 p-4">
                      <p className="text-xs font-medium text-[var(--muted)]">
                        受講者の平均進捗
                      </p>
                      <div className="mt-2 flex items-end gap-2">
                        <span className="text-2xl font-semibold tabular-nums text-[var(--foreground)]">
                          {progressSummary.avg}%
                        </span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)] ring-1 ring-[var(--border)]/50">
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
                          style={{ width: `${progressSummary.avg}%` }}
                          role="presentation"
                        />
                      </div>
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        登録 {progressSummary.enrolled} 名の単純平均
                      </p>
                    </div>
                    <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/80 p-4 dark:bg-emerald-950/30">
                      <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200/90">
                        全課題完了
                      </p>
                      <p className="mt-2 text-2xl font-semibold tabular-nums text-emerald-800 dark:text-emerald-100">
                        {progressSummary.completedAll}
                        <span className="text-base font-normal text-[var(--muted)]">
                          {" "}
                          名
                        </span>
                      </p>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/40 p-4">
                      <p className="text-xs font-medium text-[var(--muted)]">
                        一部完了（進行中）
                      </p>
                      <p className="mt-2 text-2xl font-semibold tabular-nums">
                        {progressSummary.inProgress}
                        <span className="text-base font-normal text-[var(--muted)]">
                          {" "}
                          名
                        </span>
                      </p>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/40 p-4">
                      <p className="text-xs font-medium text-[var(--muted)]">
                        未着手（0 完了）
                      </p>
                      <p className="mt-2 text-2xl font-semibold tabular-nums">
                        {progressSummary.notStarted}
                        <span className="text-base font-normal text-[var(--muted)]">
                          {" "}
                          名
                        </span>
                      </p>
                    </div>
                  </div>
                ) : null}
                <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                      <th className="pb-3 pr-4 font-medium">ログイン ID</th>
                      <th className="pb-3 pr-4 font-medium">ユーザー名</th>
                      <th className="pb-3 pr-4 font-medium">ロール</th>
                      <th className="pb-3 pr-4 font-medium">アカウント</th>
                      <th className="pb-3 pr-4 font-medium">完了 / 全課題</th>
                      <th className="min-w-[12rem] pb-3 pl-1 font-medium">
                        進捗（一覧）
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {progressUsers.map((u) => {
                      const pct = userProgressPercent(u);
                      return (
                        <tr
                          key={u.user_id}
                          className="border-b border-[var(--border)]/80 last:border-0"
                        >
                          <td className="py-3 pr-4 align-middle">
                            <Link
                              href={`/admin/users/${u.user_id}`}
                              className="text-[var(--accent)] hover:underline"
                            >
                              {u.login_id}
                            </Link>
                          </td>
                          <td className="py-3 pr-4 align-middle">{u.user_name}</td>
                          <td className="py-3 pr-4 align-middle">{roleLabel(u.role)}</td>
                          <td className="py-3 pr-4 align-middle">
                            {statusLabel(u.user_status)}
                          </td>
                          <td className="py-3 pr-4 align-middle tabular-nums">
                            {u.completed_count} / {u.total_tasks}
                          </td>
                          <td className="py-3 pl-1 align-middle">
                            <ProgressBarCell pct={pct} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                {!progressLoading && progressUsers.length === 0 && !progressErr ? (
                  <p className="mt-4 text-sm text-[var(--muted)]">
                    このコースに受講登録されているユーザーはいません。ユーザー詳細からコースを割り当ててください。
                  </p>
                ) : null}
              </div>
            )}
          </section>
        )}
      </div>

      {modalAddOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-add-task-title"
          onClick={() => {
            if (!savingNew) setModalAddOpen(false);
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="modal-add-task-title" className="text-lg font-semibold">
              タスクを登録
            </h2>
            <form onSubmit={addTask} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs text-[var(--muted)]">課題名</label>
                <input
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  required
                  maxLength={200}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--muted)]">説明（任意）</label>
                <textarea
                  value={newTaskDesc}
                  onChange={(e) => setNewTaskDesc(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  maxLength={4000}
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--muted)]">
                  表示順（1 始まり。空欄で末尾）
                </label>
                <input
                  type="number"
                  min={1}
                  value={newTaskOrder}
                  onChange={(e) => setNewTaskOrder(e.target.value)}
                  className="mt-1 w-32 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={savingNew}
                  onClick={() => setModalAddOpen(false)}
                  className="rounded-md border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--surface-muted)] disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={savingNew}
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  {savingNew ? "登録中…" : "登録"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {modalBulkOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-bulk-task-title"
          onClick={closeBulkImportModal}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id="modal-bulk-task-title"
                  className="text-lg font-semibold text-[var(--foreground)]"
                >
                  JSON をアップロード
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  既存の課題の末尾に追加されます（最大 {BULK_TASK_MAX} 件）。説明に改行を含める場合は JSON 内で{" "}
                  <code className="rounded bg-[var(--surface-muted)] px-1 font-mono text-xs">
                    \n
                  </code>{" "}
                  と書きます。
                </p>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  <a
                    href="/templates/task-bulk-import.json"
                    download="task-bulk-import.json"
                    className="text-[var(--accent)] hover:underline"
                  >
                    テンプレートをダウンロード
                  </a>
                </p>
              </div>
              <button
                type="button"
                aria-label="閉じる"
                disabled={bulkPending || bulkReadingFile}
                onClick={closeBulkImportModal}
                className="shrink-0 rounded-md p-1.5 text-xl leading-none text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                ×
              </button>
            </div>

            <form onSubmit={submitBulkJson} className="mt-5 space-y-4">
              <input
                id="bulk-json-file-drop"
                ref={bulkFileInputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                tabIndex={-1}
                disabled={bulkPending || bulkReadingFile}
                onChange={(e) => {
                  onBulkJsonInputChange(e.target.files);
                  e.target.value = "";
                }}
              />
              <label
                htmlFor="bulk-json-file-drop"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!bulkPending && !bulkReadingFile) setBulkDragActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setBulkDragActive(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setBulkDragActive(false);
                  if (bulkPending || bulkReadingFile) return;
                  const file = e.dataTransfer.files?.[0];
                  if (!file) return;
                  const ok =
                    file.type === "application/json" ||
                    file.name.toLowerCase().endsWith(".json");
                  if (!ok) {
                    setErr("JSON ファイル（.json）を選択してください");
                    return;
                  }
                  ingestBulkJsonFile(file);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition-colors ${
                  bulkDragActive
                    ? "border-[var(--accent)] bg-[var(--accent)]/5"
                    : "border-[var(--border)] bg-[var(--surface-muted)]/30 hover:border-[var(--accent)]/50"
                } ${bulkPending || bulkReadingFile ? "pointer-events-none opacity-60" : ""}`}
              >
                <svg
                  className={`h-12 w-12 shrink-0 ${bulkDragActive ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 10.5 12 7.5m0 0-3 3m3-3v7.5"
                  />
                </svg>
                <p className="mt-4 text-center text-sm text-[var(--foreground)]">
                  ここにドラッグ＆ドロップするか、
                  <span className="mx-1 font-medium text-[var(--accent)] underline decoration-[var(--accent)]/30 underline-offset-2">
                    ファイルを選択
                  </span>
                  （クリック）
                </p>
                <p className="mt-2 text-center text-xs text-[var(--muted)]">
                  UTF-8 の JSON。最大 {formatFileSize(BULK_JSON_MAX_BYTES)}
                </p>
              </label>

              {bulkFileMeta ? (
                <div className="space-y-2">
                  {bulkReadingFile ? (
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      読み込み中
                    </p>
                  ) : bulkPending ? (
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      登録中
                    </p>
                  ) : null}
                  <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/40 px-3 py-2.5">
                    <svg
                      className="h-9 w-9 shrink-0 text-[var(--muted)]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                      />
                    </svg>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">
                        {bulkFileMeta.name}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {formatFileSize(bulkFileMeta.size)}
                      </p>
                      {bulkReadingFile ? (
                        <div
                          className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)] ring-1 ring-[var(--border)]/60"
                          role="progressbar"
                          aria-busy
                          aria-label="読み込み中"
                        >
                          <div className="h-full w-2/5 animate-pulse rounded-full bg-[var(--accent)]" />
                        </div>
                      ) : null}
                      {bulkPending && bulkSubmitProgress !== null ? (
                        <div className="mt-2 flex items-center gap-2">
                          <div
                            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-muted)] ring-1 ring-[var(--border)]/60"
                            role="progressbar"
                            aria-valuenow={Math.round(bulkSubmitProgress)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
                              style={{
                                width: `${Math.min(100, Math.max(0, bulkSubmitProgress))}%`,
                              }}
                            />
                          </div>
                          <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-[var(--foreground)]">
                            {Math.round(
                              Math.min(100, Math.max(0, bulkSubmitProgress)),
                            )}
                            %
                          </span>
                        </div>
                      ) : null}
                    </div>
                    {!bulkPending && !bulkReadingFile ? (
                      <button
                        type="button"
                        aria-label="ファイルを解除"
                        onClick={removeBulkSelectedFile}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={
                    bulkPending ||
                    bulkReadingFile ||
                    !bulkJsonPayload.trim() ||
                    isArchived
                  }
                  className="min-w-[200px] rounded-lg bg-[var(--accent)] px-8 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulkPending ? "登録中…" : "一括登録"}
                </button>
                <button
                  type="button"
                  disabled={bulkPending || bulkReadingFile}
                  onClick={closeBulkImportModal}
                  className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] hover:underline disabled:opacity-50"
                >
                  キャンセル
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={archiveOpen}
        title="コースをアーカイブ"
        message="このコースをアーカイブしますか？受講者のコース一覧・演習からは表示されなくなります。"
        confirmLabel="アーカイブ"
        danger
        pending={statusPending}
        pendingLabel="処理中…"
        onConfirm={() => void patchCourseStatus("archived")}
        onCancel={() => {
          if (statusPending) return;
          setArchiveOpen(false);
        }}
      />
      <ConfirmDialog
        open={deleteTaskId !== null}
        title="課題を削除"
        message={
          deleteTaskId
            ? `この課題を削除しますか？この操作は取り消せません。`
            : ""
        }
        confirmLabel="削除"
        danger
        pending={deletePending}
        pendingLabel="削除中…"
        onConfirm={() => void deleteTask()}
        onCancel={() => {
          if (deletePending) return;
          setDeleteTaskId(null);
        }}
      />
      <ConfirmDialog
        open={restoreOpen}
        title="コースを有効化"
        message="このコースを再度有効にしますか？受講者の画面に再表示されます。"
        confirmLabel="有効化"
        pending={statusPending}
        pendingLabel="処理中…"
        onConfirm={() => void patchCourseStatus("active")}
        onCancel={() => {
          if (statusPending) return;
          setRestoreOpen(false);
        }}
      />
    </div>
  );
}
