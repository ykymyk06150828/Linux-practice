export default function MaintenancePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">メンテナンス中</h1>
        <p className="mt-4 text-[var(--muted)]">
          現在はシステムのメンテナンス中です。しばらくしてからアクセスしてください。
        </p>
        <p className="mt-3 text-sm text-[var(--muted)]">利用再開予定: 未定</p>
      </div>
    </main>
  );
}
