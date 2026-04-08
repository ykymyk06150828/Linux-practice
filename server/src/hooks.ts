import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@prisma/client";
import type { AppConfig } from "./config.js";
import { ApiError } from "./lib/errors.js";
import { getSession, refreshSessionTtl } from "./lib/sessions.js";
import type { Redis } from "ioredis";

export function createAuthHooks(config: AppConfig, redis: Redis) {
  async function loadSession(req: FastifyRequest, _reply: FastifyReply) {
    const sid = req.cookies[config.SESSION_COOKIE_NAME] as string | undefined;
    const session = await getSession(redis, sid);
    if (session && sid) {
      req.session = session;
      await refreshSessionTtl(redis, config, sid, session.userId);
    }
  }

  async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
    if (!req.session) {
      throw new ApiError(401, "AUTH_REQUIRED", "ログインが必要です");
    }
  }

  function requireRole(...roles: Role[]) {
    return async (req: FastifyRequest, _reply: FastifyReply) => {
      if (!req.session) {
        throw new ApiError(401, "AUTH_REQUIRED", "ログインが必要です");
      }
      if (!roles.includes(req.session.role)) {
        throw new ApiError(403, "FORBIDDEN", "権限がありません");
      }
    };
  }

  return { loadSession, requireAuth, requireRole };
}
