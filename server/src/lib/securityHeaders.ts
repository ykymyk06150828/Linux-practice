import type { FastifyReply } from "fastify";

/**
 * JSON API 向け。HTML を返さない前提で最小限の CSP。
 * `10_セキュリティ設計書.md` §5-3, §5-10 に沿う。
 */
export function applyApiSecurityHeaders(reply: FastifyReply): void {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  reply.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );
  reply.header(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
}
