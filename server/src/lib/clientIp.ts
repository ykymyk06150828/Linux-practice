import type { FastifyRequest } from "fastify";

/** レート制限・ログ用。プロキシ配下では `trustProxy` と `X-Forwarded-For` を前提とする */
export function getClientIp(req: FastifyRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].trim();
  }
  return req.ip || "unknown";
}

/** Redis キー用（IPv6 の `:` 等を避ける） */
export function sanitizeIpForKey(ip: string): string {
  return ip.replace(/[^a-zA-Z0-9._-]/g, "_");
}
