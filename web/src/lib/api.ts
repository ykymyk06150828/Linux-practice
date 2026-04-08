/** ブラウザでは Next の rewrite 経由で /api → バックエンド（Cookie を同一オリジンに） */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T | undefined> {
  /** DELETE 等・本文なしのときに Content-Type: application/json を付けると、サーバーが空 JSON 解析で失敗することがある */
  const hasBody =
    init?.body !== undefined && init.body !== null && init.body !== "";

  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const errPart = (body as { error?: { message?: string; code?: string; details?: Record<string, unknown> } })
      ?.error;
    const fromJson = errPart?.message;
    const nonJsonBody = Boolean(text.length > 0 && body === null);
    /** Next の rewrite 先（バックエンド）が落ちていると 500 + プレーンテキストになりがち */
    const fallback =
      res.status === 502 || res.status === 503
        ? "サーバーに接続できません。バックエンド・データベース・Redis が起動しているか確認してください。"
        : res.status === 500 && nonJsonBody
          ? "API に接続できません。server ディレクトリで npm run dev（既定ポート 3001）を起動し、PostgreSQL と Redis も動いているか確認してください。"
          : res.status === 500
            ? "サーバーでエラーが発生しました。しばらく待ってから再度お試しください。"
            : undefined;
    const msg = fromJson ?? fallback ?? res.statusText;
    const code = errPart?.code;
    const details = errPart?.details;
    throw new ApiError(msg || "リクエストに失敗しました", res.status, code, details);
  }

  return body as T;
}
