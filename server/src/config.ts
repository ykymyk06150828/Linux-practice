import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** リバースプロキシ配下で `X-Forwarded-For` を信頼する（本番で true を推奨） */
  TRUST_PROXY: z.coerce.boolean().default(false),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /** 同一 IP のログイン失敗がこの回数に達するとロックアウト（`10` §5-13） */
  LOGIN_RATE_MAX_ATTEMPTS: z.coerce.number().min(1).max(100).default(10),
  LOGIN_RATE_WINDOW_SEC: z.coerce.number().min(60).default(900),
  /** `/api/*`（health/ready 除く）の 1 分あたり最大リクエスト数 */
  API_RATE_MAX_PER_MIN: z.coerce.number().min(30).default(400),
  SESSION_COOKIE_NAME: z.string().default("session_id"),
  SESSION_TTL_SEC: z.coerce.number().default(60 * 60 * 8),
  FRONTEND_ORIGIN: z.string().min(1).optional(),
  DOCKER_SOCKET_PATH: z.string().default("/var/run/docker.sock"),
  LEARNER_IMAGE: z.string().default("linuxtrainer-learner:latest"),
  /** none=外向き通信不可（厳格） / bridge=既定ブリッジ（dnf・外部HTTPS 等に到達可） */
  LEARNER_CONTAINER_NETWORK_MODE: z.enum(["none", "bridge"]).default("bridge"),
  IDLE_WARN_SEC: z.coerce.number().default(60 * 20),
  IDLE_DISCONNECT_SEC: z.coerce.number().default(60 * 30),
  /**
   * ターミナル WS 未接続かつ最終アクセスからこの秒数を超えた研修コンテナを削除する。0 で無効。
   * メモリ節約用。再接続時は ensureLearnerContainer で再作成（待ち時間あり）。
   */
  LEARNER_CONTAINER_IDLE_RELEASE_SEC: z.coerce.number().default(60 * 60),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten());
    throw new Error("Invalid environment variables");
  }
  return parsed.data;
}
