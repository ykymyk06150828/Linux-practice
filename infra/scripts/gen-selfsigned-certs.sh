#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="${DIR}/nginx/certs"
mkdir -p "${CERT_DIR}"
KEY="${CERT_DIR}/server.key"
CRT="${CERT_DIR}/server.crt"

if [[ -f "${KEY}" && -f "${CRT}" ]]; then
  echo "証明書が既に存在します: ${CRT}"
  echo "再生成する場合は ${CERT_DIR} 内の server.key / server.crt を削除して再実行してください。"
  exit 0
fi

openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout "${KEY}" \
  -out "${CRT}" \
  -subj "/CN=localhost/O=linux-trainer-dev/C=JP"

chmod 600 "${KEY}"
echo "自己署名証明書を生成しました: ${CRT}"
echo "本番では Let's Encrypt / ACM / 社内 CA に差し替えてください。"
