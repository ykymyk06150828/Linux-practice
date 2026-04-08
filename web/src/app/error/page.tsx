import Link from "next/link";

export default function ErrorPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">エラーが発生しました</h1>
      <p className="text-center text-[var(--muted)]">
        しばらくしてから再度お試しください。
      </p>
      <Link
        href="/"
        className="rounded-md bg-[var(--accent)] px-5 py-2 text-sm text-white hover:bg-[var(--accent-hover)]"
      >
        トップへ
      </Link>
    </main>
  );
}
