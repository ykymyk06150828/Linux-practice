import Link from "next/link";

export default function SessionTimeoutPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">セッションが切れました</h1>
      <p className="text-center text-[var(--muted)]">
        再度ログインしてください。
      </p>
      <Link
        href="/login"
        className="rounded-md bg-[var(--accent)] px-5 py-2 text-sm text-white hover:bg-[var(--accent-hover)]"
      >
        再ログイン
      </Link>
    </main>
  );
}
