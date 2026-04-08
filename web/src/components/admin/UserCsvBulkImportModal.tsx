"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

const CSV_TEMPLATE = `ユーザID(メールアドレス),名前,パスワード,ロール,受講コース
user102@example.com,山田太郎102,password12,learner,コースID_1/コースID_2
admin102@example.com,管理者102,password12,admin,
`;

/** API の body 上限（server zod）に合わせる */
const CSV_IMPORT_MAX_BYTES = 2_000_000;

type RowErr = { row: number; message: string };

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
};

export function UserCsvBulkImportModal({ open, onClose, onSuccess }: Props) {
  const [csvPayload, setCsvPayload] = useState("");
  const [fileMeta, setFileMeta] = useState<{
    name: string;
    size: number;
  } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<RowErr[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setCsvPayload("");
    setFileMeta(null);
    setDragActive(false);
    setReadingFile(false);
    setSubmitProgress(null);
    setPending(false);
    setErr(null);
    setRowErrors(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open]);

  function resetFileOnly() {
    setCsvPayload("");
    setFileMeta(null);
    setReadingFile(false);
    setSubmitProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function closeModal() {
    if (pending || readingFile) return;
    resetFileOnly();
    setErr(null);
    setRowErrors(null);
    onClose();
  }

  function downloadTemplate() {
    const blob = new Blob([`\uFEFF${CSV_TEMPLATE}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "users_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function ingestFile(file: File) {
    setErr(null);
    setRowErrors(null);
    if (file.size > CSV_IMPORT_MAX_BYTES) {
      setErr(
        `ファイルサイズは最大 ${formatFileSize(CSV_IMPORT_MAX_BYTES)} までです（現在 ${formatFileSize(file.size)}）`,
      );
      return;
    }
    setReadingFile(true);
    setFileMeta({ name: file.name, size: file.size });
    const reader = new FileReader();
    reader.onload = () => {
      setCsvPayload(String(reader.result ?? ""));
      setReadingFile(false);
    };
    reader.onerror = () => {
      setErr("ファイルの読み込みに失敗しました");
      setReadingFile(false);
      setFileMeta(null);
      setCsvPayload("");
    };
    reader.readAsText(file, "UTF-8");
  }

  function onFileInputChange(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    ingestFile(file);
  }

  function removeFile() {
    if (pending || readingFile) return;
    resetFileOnly();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || readingFile || !csvPayload.trim()) return;
    setErr(null);
    setRowErrors(null);
    setPending(true);
    setSubmitProgress(0);
    const tick = window.setInterval(() => {
      setSubmitProgress((p) => (p === null ? 0 : Math.min(92, p + 9)));
    }, 200);
    let succeeded = false;
    try {
      const res = await api<{ created: number }>("/api/admin/users/import", {
        method: "POST",
        body: JSON.stringify({ csv: csvPayload }),
      });
      setSubmitProgress(100);
      if (res) {
        await onSuccess();
        succeeded = true;
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.message);
        const raw = e.details?.errors;
        if (Array.isArray(raw)) {
          setRowErrors(raw as RowErr[]);
        }
      } else {
        setErr("インポートに失敗しました");
      }
    } finally {
      window.clearInterval(tick);
      setSubmitProgress(null);
      setPending(false);
    }
    if (succeeded) {
      setErr(null);
      setRowErrors(null);
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-user-csv-import-title"
      onClick={closeModal}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="modal-user-csv-import-title"
              className="text-lg font-semibold text-[var(--foreground)]"
            >
              CSV をアップロード
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              ヘッダー行に「ユーザ ID / メール」「名前」「パスワード」「ロール」「受講コース」が分かる列名を付けるか、ヘッダーなしで左から 5 列としてください。
            </p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
              <button
                type="button"
                onClick={downloadTemplate}
                className="text-[var(--accent)] hover:underline"
              >
                テンプレートをダウンロード
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="閉じる"
            disabled={pending || readingFile}
            onClick={closeModal}
            className="shrink-0 rounded-md p-1.5 text-xl leading-none text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            ×
          </button>
        </div>

        <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-[var(--muted)]">
          <li>ロール: learner / admin または 受講者 / 管理者</li>
          <li>
            受講コースは{" "}
            <code className="rounded bg-[var(--surface-muted)] px-0.5 font-mono">/</code>{" "}
            区切りの{" "}
            <span className="font-medium text-[var(--foreground)]">
              コース ID（UUID）のみ
            </span>
            （コース名は不可）。管理者は空欄可。
          </li>
        </ul>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <input
            id="user-csv-file-drop"
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            tabIndex={-1}
            disabled={pending || readingFile}
            onChange={(e) => {
              onFileInputChange(e.target.files);
              e.target.value = "";
            }}
          />
          <label
            htmlFor="user-csv-file-drop"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!pending && !readingFile) setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(false);
              if (pending || readingFile) return;
              const file = e.dataTransfer.files?.[0];
              if (!file) return;
              const ok =
                file.type === "text/csv" ||
                file.name.toLowerCase().endsWith(".csv");
              if (!ok) {
                setErr("CSV ファイル（.csv）を選択してください");
                return;
              }
              ingestFile(file);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-colors ${
              dragActive
                ? "border-[var(--accent)] bg-[var(--accent)]/5"
                : "border-[var(--border)] bg-[var(--surface-muted)]/30 hover:border-[var(--accent)]/50"
            } ${pending || readingFile ? "pointer-events-none opacity-60" : ""}`}
          >
            <svg
              className={`h-12 w-12 shrink-0 ${dragActive ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
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
              UTF-8 の CSV。最大 {formatFileSize(CSV_IMPORT_MAX_BYTES)}
            </p>
          </label>

          {fileMeta ? (
            <div className="space-y-2">
              {readingFile ? (
                <p className="text-sm font-medium text-[var(--foreground)]">
                  読み込み中
                </p>
              ) : pending ? (
                <p className="text-sm font-medium text-[var(--foreground)]">
                  取り込み中
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
                    {fileMeta.name}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {formatFileSize(fileMeta.size)}
                  </p>
                  {readingFile ? (
                    <div
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)] ring-1 ring-[var(--border)]/60"
                      role="progressbar"
                      aria-busy
                      aria-label="読み込み中"
                    >
                      <div className="h-full w-2/5 animate-pulse rounded-full bg-[var(--accent)]" />
                    </div>
                  ) : null}
                  {pending && submitProgress !== null ? (
                    <div className="mt-2 flex items-center gap-2">
                      <div
                        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-muted)] ring-1 ring-[var(--border)]/60"
                        role="progressbar"
                        aria-valuenow={Math.round(submitProgress)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
                          style={{
                            width: `${Math.min(100, Math.max(0, submitProgress))}%`,
                          }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-[var(--foreground)]">
                        {Math.round(Math.min(100, Math.max(0, submitProgress)))}%
                      </span>
                    </div>
                  ) : null}
                </div>
                {!pending && !readingFile ? (
                  <button
                    type="button"
                    aria-label="ファイルを解除"
                    onClick={removeFile}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {err ? (
            <p className="text-sm text-[var(--danger)]" role="alert">
              {err}
            </p>
          ) : null}
          {rowErrors && rowErrors.length > 0 ? (
            <div className="rounded-md border border-red-200 bg-[var(--danger-bg)] p-3">
              <p className="text-sm font-medium text-[var(--danger)]">
                行ごとのエラー
              </p>
              <ul className="mt-2 max-h-60 list-inside list-disc space-y-1 overflow-y-auto text-sm">
                {rowErrors.map((r, i) => (
                  <li key={`${r.row}-${i}-${r.message}`}>
                    {r.row > 0 ? `行 ${r.row}: ` : ""}
                    {r.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={pending || readingFile || !csvPayload.trim()}
              className="min-w-[200px] rounded-lg bg-[var(--accent)] px-8 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "取り込み中…" : "インポート実行"}
            </button>
            <button
              type="button"
              disabled={pending || readingFile}
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
