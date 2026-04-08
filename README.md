# mk-linuxmaster（Linux コマンド研修アプリ）

ブラウザ上で Linux コマンド研修を行うためのプロジェクトです。設計書・インフラ定義を含みます。

## ドキュメント

- **利用手順（起動・環境変数・HTTPS・トラブルシュート）**  
  → [`docs/06_利用手順.md`](docs/06_利用手順.md)

- 進捗・フェーズ一覧: [`docs/00_進捗管理表.md`](docs/00_進捗管理表.md)
- 要件定義: [`docs/01_要件定義書.md`](docs/01_要件定義書.md)
- 基本設計: [`docs/02_基本設計書.md`](docs/02_基本設計書.md)
- 画面設計: [`docs/03_画面設計書.md`](docs/03_画面設計書.md)
- 詳細設計: [`docs/04_詳細設計書.md`](docs/04_詳細設計書.md)
- インフラ構成: [`docs/05_インフラ構成書.md`](docs/05_インフラ構成書.md)
- 非機能・セキュリティ・運用（フェーズ8）: [`docs/07_非機能セキュリティ運用.md`](docs/07_非機能セキュリティ運用.md)
- 結合・受入テスト（フェーズ9）: [`docs/08_結合受入テスト.md`](docs/08_結合受入テスト.md)

## インフラ（Docker）

PostgreSQL / Redis / Nginx は **`infra/`** で Docker Compose により起動します。具体的なコマンドは **`docs/06_利用手順.md`** を参照してください。

## バックエンド API

**`server/`** に Fastify + Prisma + Redis + Docker（研修コンテナ）の実装があります。セットアップと初期アカウントは **`server/README.md`** および **`docs/06_利用手順.md` の「8. バックエンド API」** を参照してください。

## フロントエンド（Next.js）

**`web/`** に Next.js 15 の画面実装があります。開発サーバは **`cd web && npm run dev`**（ポート 3000）。API は `next.config.ts` の rewrite でバックエンド（既定 3001）へプロキシします。詳細は **`web/.env.example`** と **`docs/06_利用手順.md` の「9. フロントエンド」** を参照してください。
