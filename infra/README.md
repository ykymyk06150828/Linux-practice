# インフラ（フェーズ5）

PostgreSQL / Redis / Nginx を Docker Compose で起動するための定義です。アプリ本体はフェーズ6で追加します。

**利用手順の本文（起動・`.env`・HTTPS・停止・トラブルシュート）はリポジトリの [`docs/06_利用手順.md`](../docs/06_利用手順.md) に集約しています。** 本ファイルは `infra/` 配下の概要メモです。

## 前提

- Docker Engine 24+ および Docker Compose V2
- 開発マシンでは Docker Desktop（macOS / Windows）または Linux 上の Docker
- `host.docker.internal` が使えること（Linux は Compose の `extra_hosts: host-gateway` 済み）

## 初回セットアップ

```bash
cd infra
cp env.example .env
# .env の POSTGRES_PASSWORD を変更する

chmod +x scripts/gen-selfsigned-certs.sh scripts/verify-infra.sh
./scripts/gen-selfsigned-certs.sh   # 開発用 TLS ファイル（HTTPS 有効化時に使用）

docker compose up -d
./scripts/verify-infra.sh
```

## サービス

| サービス | イメージ | ホスト向けポート | 用途 |
|----------|-----------|------------------|------|
| postgres | postgres:15-alpine | 127.0.0.1:5432 | アプリ用 DB（PostgreSQL で確定） |
| redis | redis:7-alpine | 127.0.0.1:6379 | セッション |
| nginx | nginx:1.26-alpine | 0.0.0.0:80 | リバースプロキシ（`/api/` `/ws/` → :3001、その他 → :3000） |

## Nginx とアプリ

- 既定は **HTTP のみ（ポート 80）**。証明書を配置し `nginx/conf.d/https.conf.example` を `https.conf` にコピーしたうえで、`docker-compose.yml` の **443 ポートのコメントを外して** 再起動する。
- 上流は `host.docker.internal:3000`（Web）と `:3001`（API / WebSocket）。フェーズ6でローカル起動後に合わせる。

## 証明書

- `./scripts/gen-selfsigned-certs.sh` は開発用の自己署名証明書を `nginx/certs/` に生成する。
- 本番は Let's Encrypt、AWS ACM、社内 CA 等に差し替える（`docs/05_インフラ構成書.md` 参照）。

## Docker ホストのチューニング

- `docker/daemon.json.example` を参考に、ログローテーションや ulimit を設定する（本番ホスト）。

## トラブルシュート

- **Nginx が upstream に接続できない**: ホストでアプリが未起動のときは 502 になる。まず DB / Redis / `curl http://127.0.0.1/healthz` を確認する。
- **Linux で host.docker.internal が効かない**: `docker-compose.yml` の `extra_hosts` を環境に合わせて修正する。

詳細は `docs/05_インフラ構成書.md` を参照してください。操作手順は **`docs/06_利用手順.md`** を参照してください。
