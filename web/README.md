# linuxtrainer-web（フロントエンド）

Next.js 15（App Router）+ Tailwind CSS + xterm.js。

## 開発

```bash
cp .env.example .env.local
npm install
npm run dev
```

- アプリ: http://127.0.0.1:3000  
- API は `next.config.ts` の rewrite で `BACKEND_URL`（既定 `http://127.0.0.1:3001`）へ転送されます。

## 環境変数

| 変数 | 説明 |
|------|------|
| `BACKEND_URL` | サーバ側 rewrite 先（ビルド／dev 時） |
| `NEXT_PUBLIC_WS_URL` | ターミナル用 WebSocket（既定 `ws://127.0.0.1:3001/ws/terminal`） |

バックエンドの `FRONTEND_ORIGIN` に `http://localhost:3000` または `http://127.0.0.1:3000` を設定してください。

## 画面ルート（概要）

| パス | 内容 |
|------|------|
| `/` | トップ・入口 |
| `/login` | 受講者ログイン |
| `/admin/login` | 管理者ログイン |
| `/learner` | 受講者トップ |
| `/learner/terminal` | ターミナル（xterm） |
| `/admin` | 管理者ダッシュボード |
| `/admin/users` | 受講者一覧 |
| `/admin/users/[userId]` | 受講者詳細 |
| `/admin/containers` | コンテナ一覧 |
| `/admin/logs` | ログ |
| `/error` `/forbidden` `/session-timeout` `/maintenance` | 共通画面 |
