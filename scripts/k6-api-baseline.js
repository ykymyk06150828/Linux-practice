/**
 * フェーズ9: API ベースライン負荷（30 同時程度）
 * 実行: k6 run scripts/k6-api-baseline.js
 * 環境: BASE_URL=http://127.0.0.1:3001 （既定）
 */
import http from "k6/http";
import { check, sleep } from "k6";

const base = __ENV.BASE_URL || "http://127.0.0.1:3001";

export const options = {
  vus: 30,
  duration: "60s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2000"],
  },
};

export default function () {
  const res = http.get(`${base}/api/ready`);
  check(res, {
    "status 200": (r) => r.status === 200,
  });
  sleep(0.3);
}
