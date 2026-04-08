"use client";

import { useEffect, useState } from "react";
import { ShellHeader } from "@/components/ShellHeader";
import { api, ApiError } from "@/lib/api";

type Log = {
  timestamp: string;
  type: string;
  message: string;
  result: string;
  metadata: Record<string, unknown>;
};

export default function AdminLogsPage() {
  const [name, setName] = useState("");
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{ user: { user_name: string } }>("/api/auth/me");
        if (cancelled || !me) return;
        setName(me.user.user_name);
        const data = await api<{ logs: Log[]; total: number }>(
          "/api/admin/logs?limit=50",
        );
        if (cancelled || !data) return;
        setLogs(data.logs);
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
        title="ログ閲覧"
        userName={name}
        showLogout={false}
      />
      <div className="mx-auto max-w-6xl px-4 py-8">
        {err ? <p className="mb-4 text-sm text-[var(--danger)]">{err}</p> : null}
        <p className="mb-4 text-sm text-[var(--muted)]">全 {total} 件（先頭 50 件表示）</p>
        <div className="space-y-2">
          {logs.map((l, i) => (
            <div
              key={`${l.timestamp}-${i}`}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm"
            >
              <p className="text-xs text-[var(--muted)]">{l.timestamp}</p>
              <p className="mt-1 font-medium">{l.message}</p>
              <p className="text-xs text-[var(--muted)]">結果: {l.result}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
