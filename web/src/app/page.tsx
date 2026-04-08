import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-4">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-[var(--muted)]">
          Linux コマンド研修アプリ
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          ようこそ
        </h1>
        <p className="mt-3 max-w-md text-[var(--muted)]">
          ログイン後、管理者は管理画面、受講者は研修画面へ進みます。
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/login"
          className="rounded-lg bg-[var(--accent)] px-6 py-3 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          ログイン
        </Link>
      </div>
      <p className="text-xs text-[var(--muted)]">
        画面のみ確認する場合も、このページから各ログイン画面へ進めます。
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-[var(--muted)]">
        <span className="w-full text-center sm:w-auto">共通画面:</span>
        <Link href="/error" className="hover:text-[var(--text)]">
          エラー
        </Link>
        <Link href="/forbidden" className="hover:text-[var(--text)]">
          権限エラー
        </Link>
        <Link href="/session-timeout" className="hover:text-[var(--text)]">
          セッション切れ
        </Link>
        <Link href="/maintenance" className="hover:text-[var(--text)]">
          メンテナンス
        </Link>
      </div>
    </main>
  );
}
