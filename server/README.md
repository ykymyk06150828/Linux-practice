# linuxtrainer-server（バックエンド API / WebSocket）

## 前提

- Node.js 20+
- PostgreSQL 15+（`infra` の Docker Compose で起動可）
- Redis 7+
- Docker Engine（受講者コンテナの払い出し用）
- 研修用イメージのビルド（初回・Dockerfile 変更時）

ベースは **Amazon Linux 2023**（`vi` / `sudo` / 基本コマンドを含む）。ビルド後、**既存の受講者コンテナは環境リセット**で再作成してください。

リポジトリ直下から:

```bash
docker build -t linuxtrainer-learner:latest -f server/docker/learner/Dockerfile server/docker/learner
```

または `server/` に移動してから:

```bash
cd server
docker build -t linuxtrainer-learner:latest -f docker/learner/Dockerfile docker/learner
```

## セットアップ

```bash
cd server
cp .env.example .env
# DATABASE_URL / REDIS_URL を環境に合わせて編集

npm install
npx prisma generate
npx prisma db push
npm run db:seed
```

## 開発サーバ

```bash
npm run dev
```

既定で `http://0.0.0.0:3001` で待ち受けます。

- `GET /api/health` … プロセス生存（軽量）
- `GET /api/ready` … PostgreSQL・Redis 疎通（失敗時は **503**。監視向け）

詳細は **`docs/07_非機能セキュリティ運用.md`** を参照。

## 初期アカウント（seed）

| ログイン ID | パスワード | ロール |
|-------------|------------|--------|
| admin       | admin123   | 管理者 |
| learner     | learner123 | 受講者 |

本番では必ず変更・削除してください。

## 主なエンドポイント

- REST: `docs/04_詳細設計書.md` の `/api/*`
- WebSocket: `ws://<host>:3001/ws/terminal`（Cookie セッション）

## 注意

- 研修コンテナ内では **`sudo` 演習**のため、`CapDrop ALL` / `no-new-privileges` は付けていません（setuid と両立しないため）。隔離は **リソース上限・非 root ユーザー**で行います。
- ネットワークは **`LEARNER_CONTAINER_NETWORK_MODE`**（既定 `bridge`）で切替え。`dnf install` 等は **bridge** が必要。厳格に隔離する場合のみ `none`（外向き DNS 不可）。
- 危険コマンドは **入力ミラー** 上で改行検知後に記録・警告します。完全なブロックには Docker の seccomp 等の併用を推奨します（詳細設計書 6 章）。
- Nginx 経由で動かす場合は `infra/nginx/conf.d/default.conf` の上流ポート（3000/3001）と合わせてください。
