#!/usr/bin/env bash
# フェーズ9: 結合スモーク（バックエンド API）
# 前提: PostgreSQL / Redis 起動済み、server が npm run dev で待受
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3001}"
LOGIN_ID="${LOGIN_ID:-learner}"
PASSWORD="${PASSWORD:-learner123}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
COOKIE_JAR="$tmp/cookies.txt"

echo "== GET /api/health ($BASE_URL) =="
curl -sfS "$BASE_URL/api/health" | head -c 200
echo ""
echo ""

echo "== GET /api/ready =="
curl -sfS "$BASE_URL/api/ready" | head -c 300
echo ""
echo ""

echo "== POST /api/auth/login =="
code_login="$(curl -sS -o "$tmp/login.json" -w "%{http_code}" \
  -c "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -d "{\"login_id\":\"$LOGIN_ID\",\"password\":\"$PASSWORD\"}" \
  "$BASE_URL/api/auth/login")"
echo "HTTP $code_login"
cat "$tmp/login.json"
echo ""
if [[ "$code_login" != "200" ]]; then
  echo "ログイン失敗。seed・DATABASE_URL・資格情報を確認してください。" >&2
  exit 1
fi

echo ""
echo "== GET /api/auth/me (Cookie) =="
code_me="$(curl -sS -o "$tmp/me.json" -w "%{http_code}" \
  -b "$COOKIE_JAR" \
  "$BASE_URL/api/auth/me")"
echo "HTTP $code_me"
cat "$tmp/me.json"
echo ""
if [[ "$code_me" != "200" ]]; then
  echo "/api/auth/me 失敗" >&2
  exit 1
fi

echo ""
echo "スモーク完了（OK）"
