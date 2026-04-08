"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShellHeader } from "@/components/ShellHeader";
import { api, ApiError } from "@/lib/api";

export default function AdminCourseNewPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [courseName, setCourseName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{ user: { user_name: string } }>("/api/auth/me");
        if (cancelled || !me) return;
        setName(me.user.user_name);
      } catch {
        /* RequireAuth */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const data = await api<{ course: { id: string } }>("/api/admin/courses", {
        method: "POST",
        body: JSON.stringify({
          course_name: courseName,
          description: description || undefined,
          status,
        }),
      });
      if (data?.course?.id) {
        router.replace(`/admin/courses/${data.course.id}`);
        return;
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "作成に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <ShellHeader
        title="コースを追加"
        userName={name}
        showLogout={false}
      />
      <div className="mx-auto max-w-lg px-4 py-8">
        <p className="mb-6 text-sm text-[var(--muted)]">
          コース作成後、課題（タスク）はデータベースまたは今後の管理画面から追加してください。
        </p>
        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <div>
            <label htmlFor="course_name" className="block text-sm text-[var(--muted)]">
              コース名 <span className="text-[var(--danger)]">*</span>
            </label>
            <input
              id="course_name"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 outline-none focus:border-[var(--accent)]"
              required
              maxLength={200}
            />
          </div>
          <div>
            <label htmlFor="description" className="block text-sm text-[var(--muted)]">
              説明
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 outline-none focus:border-[var(--accent)]"
              maxLength={4000}
            />
          </div>
          <div>
            <label htmlFor="status" className="block text-sm text-[var(--muted)]">
              状態
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "active" | "archived")
              }
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 outline-none focus:border-[var(--accent)]"
            >
              <option value="active">active</option>
              <option value="archived">archived</option>
            </select>
          </div>
          {err ? (
            <p className="text-sm text-[var(--danger)]" role="alert">
              {err}
            </p>
          ) : null}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {loading ? "作成中…" : "作成"}
            </button>
            <Link
              href="/admin/courses"
              className="rounded-md border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--surface-muted)]"
            >
              キャンセル
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
