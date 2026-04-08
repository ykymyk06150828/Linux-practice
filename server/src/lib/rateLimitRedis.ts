import type { Redis } from "ioredis";
import type { AppConfig } from "../config.js";
import { ApiError } from "./errors.js";
import { sanitizeIpForKey } from "./clientIp.js";

/** 全 `/api/*`（ヘルス系除く）の 1 分あたり上限 */
export async function assertGlobalApiRateLimit(
  redis: Redis,
  ip: string,
  config: AppConfig,
): Promise<void> {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `rl:api:${sanitizeIpForKey(ip)}:${minute}`;
  const n = await redis.incr(key);
  if (n === 1) {
    await redis.expire(key, 120);
  }
  if (n > config.API_RATE_MAX_PER_MIN) {
    throw new ApiError(
      429,
      "RATE_LIMIT",
      "リクエストが多すぎます。しばらく待ってから再度お試しください。",
      { retry_after_sec: 60 },
    );
  }
}

/** ログイン試行のロックアウトチェック（失敗カウントが上限未満なら通す） */
export async function assertLoginAllowed(
  redis: Redis,
  ip: string,
  config: AppConfig,
): Promise<void> {
  const key = loginFailKey(ip);
  const raw = await redis.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= config.LOGIN_RATE_MAX_ATTEMPTS) {
    const ttl = await redis.ttl(key);
    const retryAfter = ttl > 0 ? ttl : config.LOGIN_RATE_WINDOW_SEC;
    throw new ApiError(
      429,
      "TOO_MANY_LOGIN_ATTEMPTS",
      "ログイン試行回数が上限に達しました。しばらく待ってから再度お試しください。",
      { retry_after_sec: retryAfter },
    );
  }
}

export async function recordLoginFailure(
  redis: Redis,
  ip: string,
  config: AppConfig,
): Promise<void> {
  const key = loginFailKey(ip);
  const n = await redis.incr(key);
  if (n === 1) {
    await redis.expire(key, config.LOGIN_RATE_WINDOW_SEC);
  }
}

export async function clearLoginFailures(redis: Redis, ip: string): Promise<void> {
  await redis.del(loginFailKey(ip));
}

function loginFailKey(ip: string): string {
  return `login:fail:${sanitizeIpForKey(ip)}`;
}
