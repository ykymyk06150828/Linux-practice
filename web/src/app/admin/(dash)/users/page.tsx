"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ShellHeader } from "@/components/ShellHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { UserCsvBulkImportModal } from "@/components/admin/UserCsvBulkImportModal";
import { UserRegisterModal } from "@/components/admin/UserRegisterModal";
import { api, ApiError } from "@/lib/api";

type Row = {
  id: string;
  login_id: string;
  user_name: string;
  role: string;
  status: string;
  connection: { state: string; last_seen_at: string | null };
};

type SortKey = "login_id" | "user_name" | "role" | "connection";
type SortDir = "asc" | "desc";

function compareRows(a: Row, b: Row, key: SortKey, dir: SortDir): number {
  const sign = dir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (key) {
    case "login_id":
      cmp = a.login_id.localeCompare(b.login_id, "ja", {
        sensitivity: "base",
      });
      break;
    case "user_name":
      cmp = a.user_name.localeCompare(b.user_name, "ja", {
        sensitivity: "base",
      });
      break;
    case "role":
      cmp = a.role.localeCompare(b.role);
      break;
    case "connection":
      cmp = a.connection.state.localeCompare(b.connection.state);
      break;
  }
  return cmp * sign;
}

function SortGlyph({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return (
      <span className="inline-block w-4 shrink-0 text-[10px] opacity-40" aria-hidden>
        ↕
      </span>
    );
  }
  return (
    <span className="inline-block w-4 shrink-0 text-xs" aria-hidden>
      {dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

function usersListUrl(search: string): string {
  const params = new URLSearchParams();
  params.set("limit", "100");
  const q = search.trim();
  if (q) params.set("q", q);
  return `/api/admin/users?${params.toString()}`;
}

async function loadUsers(search: string): Promise<{ users: Row[]; total: number }> {
  const data = await api<{ users: Row[]; total: number }>(usersListUrl(search));
  if (!data) {
    return { users: [], total: 0 };
  }
  return data;
}

function AdminUsersPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("login_id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => compareRows(a, b, sortKey, sortDir));
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const refresh = useCallback(async () => {
    try {
      const data = await loadUsers(debouncedSearch);
      setRows(data.users);
      setTotal(data.total);
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{
          user: { user_name: string; id: string };
        }>("/api/auth/me");
        if (cancelled || !me) return;
        setName(me.user.user_name);
        setMyUserId(me.user.id);
      } catch (e) {
        if (!cancelled && e instanceof ApiError) setErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const imp = searchParams.get("import");
    const nu = searchParams.get("new");
    if (imp === "1") setImportModalOpen(true);
    if (nu === "1") setRegisterModalOpen(true);
    if (imp === "1" || nu === "1") {
      router.replace(pathname, { scroll: false });
    }
  }, [searchParams, router, pathname]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setErr(null);
        const data = await loadUsers(debouncedSearch);
        if (cancelled) return;
        setRows(data.users);
        setTotal(data.total);
      } catch (e) {
        if (!cancelled && e instanceof ApiError) setErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  const selectableIds = rows
    .map((r) => r.id)
    .filter((id) => id !== myUserId);

  function toggle(id: string) {
    if (id === myUserId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    const allSelected =
      selectableIds.length > 0 &&
      selectableIds.every((id) => selected.has(id));
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of selectableIds) next.delete(id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of selectableIds) next.add(id);
        return next;
      });
    }
  }

  async function doBulkDelete() {
    if (selected.size === 0 || deletePending) return;
    setDeletePending(true);
    setErr(null);
    try {
      await api("/api/admin/users/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ user_ids: [...selected] }),
      });
      setSelected(new Set());
      setDeleteOpen(false);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "削除に失敗しました");
    } finally {
      setDeletePending(false);
    }
  }

  const allOnPageSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selected.has(id));

  return (
    <div>
      <ShellHeader
        title="ユーザー一覧"
        userName={name}
        showLogout={false}
      />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--muted)]">
            {debouncedSearch
              ? `検索結果 ${total} 件`
              : `全 ${total} 件`}
            {selected.size > 0 ? (
              <span className="ml-2 text-[var(--foreground)]">
                （{selected.size} 件を選択中）
              </span>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {selected.size > 0 ? (
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="rounded-md border border-red-200 bg-[var(--danger-bg)] px-4 py-2 text-sm text-[var(--danger)] hover:bg-red-100"
              >
                選択したユーザーを削除
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setErr(null);
                setImportModalOpen(true);
              }}
              className="rounded-md border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--surface-muted)]"
            >
              CSV 一括登録
            </button>
            <button
              type="button"
              onClick={() => {
                setErr(null);
                setRegisterModalOpen(true);
              }}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              ユーザーを登録
            </button>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] max-w-md flex-1">
            <label
              htmlFor="admin-users-search"
              className="mb-1 block text-xs text-[var(--muted)]"
            >
              検索（ログイン ID・名前の一部）
            </label>
            <div className="flex gap-2">
              <input
                id="admin-users-search"
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="例: yamada / user@example.com"
                autoComplete="off"
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setDebouncedSearch("");
                  }}
                  className="shrink-0 rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                >
                  クリア
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {err ? (
          <p className="mb-4 text-sm text-[var(--danger)]" role="alert">
            {err}
          </p>
        ) : null}
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-[var(--surface)] text-[var(--muted)]">
              <tr>
                <th className="w-10 px-2 py-3">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAllOnPage}
                    disabled={selectableIds.length === 0}
                    aria-label="このページのユーザーをすべて選択"
                  />
                </th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("login_id")}
                    className="inline-flex w-full max-w-full items-center gap-1 rounded px-0 py-0.5 text-left font-medium text-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    aria-sort={
                      sortKey === "login_id"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    ログイン ID
                    <SortGlyph
                      active={sortKey === "login_id"}
                      dir={sortDir}
                    />
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("user_name")}
                    className="inline-flex w-full max-w-full items-center gap-1 rounded px-0 py-0.5 text-left font-medium text-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    aria-sort={
                      sortKey === "user_name"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    名前
                    <SortGlyph
                      active={sortKey === "user_name"}
                      dir={sortDir}
                    />
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("role")}
                    className="inline-flex w-full max-w-full items-center gap-1 rounded px-0 py-0.5 text-left font-medium text-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    aria-sort={
                      sortKey === "role"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    ロール
                    <SortGlyph
                      active={sortKey === "role"}
                      dir={sortDir}
                    />
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("connection")}
                    className="inline-flex w-full max-w-full items-center gap-1 rounded px-0 py-0.5 text-left font-medium text-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    aria-sort={
                      sortKey === "connection"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    接続
                    <SortGlyph
                      active={sortKey === "connection"}
                      dir={sortDir}
                    />
                  </button>
                </th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const isSelf = r.id === myUserId;
                return (
                  <tr key={r.id} className="border-t border-[var(--border)]">
                    <td className="px-2 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        disabled={isSelf}
                        title={
                          isSelf ? "自分自身は選択できません" : undefined
                        }
                        aria-label={`${r.login_id} を選択`}
                      />
                    </td>
                    <td className="px-4 py-3">{r.login_id}</td>
                    <td className="px-4 py-3">{r.user_name}</td>
                    <td className="px-4 py-3">{r.role}</td>
                    <td className="px-4 py-3">{r.connection.state}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/users/${r.id}`}
                        className="text-[var(--accent)] hover:underline"
                      >
                        詳細
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <UserCsvBulkImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={refresh}
      />
      <UserRegisterModal
        open={registerModalOpen}
        onClose={() => setRegisterModalOpen(false)}
        onSuccess={refresh}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="ユーザーの一括削除"
        message={`選択した ${selected.size} 件のユーザーを削除します。元に戻せません。よろしいですか？`}
        confirmLabel="削除する"
        danger
        pending={deletePending}
        pendingLabel="削除中…"
        onConfirm={() => void doBulkDelete()}
        onCancel={() => {
          if (deletePending) return;
          setDeleteOpen(false);
        }}
      />
    </div>
  );
}

function AdminUsersPageFallback() {
  return (
    <div>
      <ShellHeader title="ユーザー一覧" userName="" showLogout={false} />
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-[var(--muted)]">
        読み込み中…
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<AdminUsersPageFallback />}>
      <AdminUsersPageContent />
    </Suspense>
  );
}
