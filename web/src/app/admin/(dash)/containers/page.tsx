"use client";

import { useEffect, useState } from "react";
import { ShellHeader } from "@/components/ShellHeader";
import { api, ApiError } from "@/lib/api";

type C = {
  container_id: string | null;
  container_name: string;
  user_id: string;
  login_id: string;
  user_name: string;
  status: string;
  last_access_at: string | null;
};

export default function AdminContainersPage() {
  const [name, setName] = useState("");
  const [rows, setRows] = useState<C[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{ user: { user_name: string } }>("/api/auth/me");
        if (cancelled || !me) return;
        setName(me.user.user_name);
        const data = await api<{ containers: C[]; total: number }>(
          "/api/admin/containers?limit=100",
        );
        if (cancelled || !data) return;
        setRows(data.containers);
        setTotal(data.total);
      } catch (e) {
        if (!cancelled && e instanceof ApiError) setErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <ShellHeader
        title="コンテナ一覧"
        userName={name}
        showLogout={false}
      />
      <div className="mx-auto max-w-6xl px-4 py-8">
        {err ? <p className="mb-4 text-sm text-[var(--danger)]">{err}</p> : null}
        <p className="mb-4 text-sm text-[var(--muted)]">全 {total} 件</p>
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-[var(--surface)] text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">コンテナ名</th>
                <th className="px-4 py-3 font-medium">ログイン ID</th>
                <th className="px-4 py-3 font-medium">状態</th>
                <th className="px-4 py-3 font-medium">最終アクセス</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.container_name} className="border-t border-[var(--border)]">
                  <td className="px-4 py-3 font-mono text-xs">{r.container_name}</td>
                  <td
                    className="px-4 py-3 font-mono text-xs"
                    title={`内部ID: ${r.user_id}`}
                  >
                    <span className="text-[var(--text)]">{r.login_id}</span>
                    {r.user_name ? (
                      <span className="mt-0.5 block font-sans text-xs font-normal text-[var(--muted)]">
                        {r.user_name}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{r.status}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {r.last_access_at ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
