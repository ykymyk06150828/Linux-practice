import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">権限がありません</h1>
      <p className="text-center text-[var(--muted)]">
        この画面にアクセスする権限がありません。
      </p>
      <Link href="/login" className="text-[var(--accent)] hover:underline">
        ログインへ
      </Link>
    </main>
  );
}
