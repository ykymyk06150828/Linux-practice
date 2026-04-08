# プロジェクト・ナレッジ（運用・拡張・障害対応メモ）

本ファイルは **都度追記** する。設計の正は `01`〜`08` の各ドキュメントとコードに従う。

---

## 1. スタックと役割（短縮）

| 領域 | 技術・パス |
|------|------------|
| フロント | `web/` Next.js 15、`/api/*` は `next.config.ts` の rewrite でバックエンドへ |
| API / WS | `server/` Fastify、ポート既定 **3001** |
| DB | PostgreSQL（Prisma）、Redis（セッション） |
| 研修コンテナ | ホスト Docker、`LEARNER_IMAGE`、イメージは `server/docker/learner/` |
| 基盤 | `infra/` Compose（PostgreSQL / Redis / Nginx） |

**開発時:** フロント **3000** とバックエンド **3001** を **両方** 起動。片方だけだとログインやターミナルが失敗する。

---

## 2. 環境変数でハマりやすい点

- **`server/.env` の `DATABASE_URL`** は `infra/.env` の `POSTGRES_PASSWORD` と一致させる。Docker の **初回ボリューム**で決まったパスワードは、後から `.env` だけ変えても DB 内は変わらない → `ALTER USER` か `docker compose down -v`（**データ消失**に注意）。
- **`FRONTEND_ORIGIN`** はブラウザで開く URL（`localhost` と `127.0.0.1` の混在に注意）。
- **`LEARNER_CONTAINER_NETWORK_MODE`**: `bridge` でコンテナから外向き通信（`dnf` 等）。厳格隔離は `none`（DNS 不可）。

---

## 3. Docker / 研修コンテナ

- 研修イメージは **Amazon Linux 2023** ベース。ビルド: `server/README.md` の `docker build` コマンド（パスは **`server/docker/learner`**）。
- **sudo 演習**のため `CapDrop ALL` / `no-new-privileges` は付けていない（`docker-runtime.ts`）。隔離は **ネットワーク・メモリ上限・非 root ユーザー** などで担保。
- イメージ更新後は **環境リセット**でコンテナを作り直す。
- **ポート競合:** ホストの PostgreSQL が 5432 を占有していると Compose の Postgres が起動しない → `lsof` で確認し、ホスト側を止めるか Compose 側のホストポートを変更。

---

## 4. フロント（Next / xterm）

- **ハイドレーション:** ブラウザ拡張が `<body>` に属性を注入すると警告が出る → `layout.tsx` の `body` に `suppressHydrationWarning`。
- **xterm FitAddon:** `fit()` はコンテナサイズ 0×0 やレンダラ未初期化で `dimensions` エラーになりうる → **`TerminalPane` の `safeFit` + 二重 rAF** パターンを維持すること。
- **ターミナル再接続:** `sessionKey` で WS＋xterm を張り直し。`onStatusChange` は ref で持ち、依存配列でループしないようにする。

---

## 5. API / 認可

- 管理者 API は `adminOnly`（`hooks.requireRole("admin")`）。一覧は `docs/07_非機能セキュリティ運用.md` や `server/src/app.ts` を参照。
- 追加済み例: `GET/POST /api/admin/courses`、`POST /api/admin/users/register` など。監査ログは `admin_audit_logs`。

---

## 6. よくある障害・エラー対応

### 6-1. 切り分けの順序（短く）

1. **バックエンドが生きているか** … `curl -sS http://127.0.0.1:3001/api/health` と `/api/ready`  
2. **DB / Redis** … `ready` が 503 なら Prisma / Redis 接続を疑う（`DATABASE_URL`・`REDIS_URL`・Compose 起動）  
3. **フロントだけ動かしている** … ログイン・API は 3001 必須  
4. **ブラウザの URL** … `localhost` と `127.0.0.1` 混在で Cookie / CORS がずれることがある  

### 6-2. 画面・メッセージと原因の対応

| 現象・メッセージ | 想定原因 | 対処のヒント |
|------------------|----------|----------------|
| ログインで「Internal Server Error」（英語）や `statusText` だけ | Next がバックエンドに繋げずプレーン 500 | `server` で `npm run dev`、3001 待受確認 |
| 「API に接続できません…3001…」（`web` のフォールバック） | 同上 | 同上。`curl http://127.0.0.1:3001/api/ready` |
| 「サーバーでエラーが発生しました」（日本語） | API は応答しているが 500（JSON） | サーバログ・Prisma 例外。`server` のターミナル出力を確認 |
| Prisma **P1000** | DB 認証失敗 | `DATABASE_URL` のユーザー／パスワード。ボリューム移行後は DB 内パスワードと不一致になりやすい |
| Prisma **P1001** / `NOT_READY` 系 | DB に到達できない | Postgres 起動、`127.0.0.1:5432`、ファイアウォール |
| **503** + 依存サービスメッセージ | `/api/ready` 失敗 | PostgreSQL・Redis 起動と接続文字列 |
| **EADDRINUSE** :3001 / :3000 | ポート占有 | `lsof -iTCP:3001 -sTCP:LISTEN` → 不要な `node` を終了 |
| **Docker** `address already in use` :5432 | ホスト Postgres と競合 | ホストの `postgres` を止めるか、Compose の公開ポートを変更 |
| **Docker** `docker.sock` 接続不可 | Docker Desktop 未起動 | Docker を起動してから `docker compose` |
| 研修コンテナで **dnf / DNS 失敗** | `NetworkMode: none` のまま | `LEARNER_CONTAINER_NETWORK_MODE=bridge` にし **環境リセット** |
| **sudo: no new privileges**（過去） | `SecurityOpt` と sudo の両立不可 | 現状は研修用に該当オプションを外す実装（`docker-runtime`） |
| **xterm** `dimensions` が undefined | `fit()` が早すぎる | `TerminalPane` の `safeFit`・二重 rAF を壊さない |
| React **ハイドレーション**（`cz-shortcut-listen` 等） | ブラウザ拡張が body を改変 | `layout.tsx` の `suppressHydrationWarning`。拡張の無効化も可 |
| ターミナル真っ黒 | WS 前のプロンプト取りこぼし等 | サーバ側 `resize`、クライアント `safeFit`、再接続ボタンで再試行 |

### 6-3. 確認コマンド例（開発機）

```bash
# API
curl -sS http://127.0.0.1:3001/api/health
curl -sS http://127.0.0.1:3001/api/ready

# ポート
lsof -iTCP:3001 -sTCP:LISTEN
lsof -iTCP:5432 -sTCP:LISTEN

# スモーク（バックエンド起動後）
./scripts/acceptance-smoke.sh
```

### 6-4. 環境リセットが二重送信で落ちる／遅い

- **対応済み:** `ConfirmDialog` の `pending` で確定・キャンセル無効＋ローディング表示（受講者トップ・管理者の受講者詳細）。
- まだ失敗する場合は **サーバ側**（Docker ビジー・タイムアウト）をログで確認。

### 6-5. ログを見る場所

- **API:** `server` 起動ターミナル（Fastify の `logger`）。
- **DB 上の監査:** `admin_audit_logs`（管理画面のログ参照）。
- **研修コンテナ:** ホストで `docker logs`（必要なら）。

---

## 7. ドキュメント索引

| ファイル | 内容 |
|----------|------|
| `docs/06_利用手順.md` | 起動・トラブルシュート |
| `docs/07_非機能セキュリティ運用.md` | 権限・監視 `/api/ready` 等 |
| `docs/08_結合受入テスト.md` | 受入・k6 スモーク |
| `scripts/acceptance-smoke.sh` | API スモーク |

---

## 8. 今後の拡張・未実装で検討しやすい項目（メモ）

- **受講者のコース紐付け:** `user_course_enrollments` はユーザー登録 API では自動設定していない。管理画面から「受講登録」する API／画面があると運用しやすい。
- **課題（Task）の CRUD:** コース詳細は参照のみ。タスク追加・編集は DB または今後の API。
- **ログイン監査を DB 永続化:** 要件次第。現状は応答＋アプリログ中心（`07` にギャップ記載）。
- **command-blocklist と sudo:** 研修で `sudo` を実際に試させるなら、ブロックリストとポリシーの整理が必要な場合あり。
- **負荷・30 人同時:** `08` の手順・k6 ベースライン。本番相当の実測はフェーズ9以降で記録。

---

## 9. 改訂履歴

| 日付 | 内容 |
|------|------|
| 2026-03-25 | 初版（運用・障害・拡張メモのたたき台） |
| 2026-03-25 | §6 を拡充（エラー種別・切り分け手順・コマンド例・リセット・ログ） |
