#!/usr/bin/env bash
# 基盤コンテナの疎通確認（アプリ未起動でも DB / Redis / Nginx 設定は検証可能）
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

echo "== docker compose ps =="
docker compose ps

echo ""
echo "== PostgreSQL (pg_isready) =="
docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-app}" -d "${POSTGRES_DB:-linuxtrainer}"

echo ""
echo "== Redis (PING) =="
docker compose exec -T redis redis-cli ping || true

echo ""
echo "== Nginx 設定テスト =="
docker compose exec -T nginx nginx -t

echo ""
echo "== HTTP /healthz (ホストから) =="
curl -sfS "http://127.0.0.1/healthz" && echo "" || echo "curl に失敗しました（Nginx が起動していない、またはポート競合）"

echo ""
echo "完了。アプリ（:3000 / :3001）が起動していれば、ブラウザでプロキシ経由の動作確認が可能です。"
