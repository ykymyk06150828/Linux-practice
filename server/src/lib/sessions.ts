import { nanoid } from "nanoid";
import type { Redis } from "ioredis";
import type { AppConfig } from "../config.js";
import type { Role } from "@prisma/client";

export type SessionPayload = {
  userId: string;
  loginId: string;
  role: Role;
};

const sessKey = (id: string) => `sess:${id}`;
const userSessKey = (userId: string) => `user_sess:${userId}`;
const wsKey = (userId: string) => `ws:uid:${userId}`;

export async function createSession(
  redis: Redis,
  config: AppConfig,
  payload: SessionPayload,
): Promise<string> {
  const existing = await redis.get(userSessKey(payload.userId));
  if (existing) {
    await redis.del(sessKey(existing));
  }
  const id = nanoid(48);
  await redis.set(sessKey(id), JSON.stringify(payload), "EX", config.SESSION_TTL_SEC);
  await redis.set(userSessKey(payload.userId), id, "EX", config.SESSION_TTL_SEC);
  return id;
}

export async function refreshSessionTtl(
  redis: Redis,
  config: AppConfig,
  sessionId: string,
  userId: string,
): Promise<void> {
  await redis.expire(sessKey(sessionId), config.SESSION_TTL_SEC);
  await redis.expire(userSessKey(userId), config.SESSION_TTL_SEC);
}

export async function getSession(
  redis: Redis,
  sessionId: string | undefined,
): Promise<SessionPayload | null> {
  if (!sessionId) return null;
  const raw = await redis.get(sessKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionPayload;
  } catch {
    return null;
  }
}

export async function deleteSession(
  redis: Redis,
  sessionId: string | undefined,
  userId?: string,
): Promise<void> {
  if (!sessionId) return;
  const payload = await getSession(redis, sessionId);
  await redis.del(sessKey(sessionId));
  if (payload?.userId) {
    await redis.del(userSessKey(payload.userId));
  } else if (userId) {
    await redis.del(userSessKey(userId));
  }
  if (payload?.userId) {
    await redis.del(wsKey(payload.userId));
  }
}

export async function markWsOnline(redis: Redis, userId: string, ttlSec: number): Promise<void> {
  await redis.set(wsKey(userId), "1", "EX", ttlSec);
}

export async function markWsOffline(redis: Redis, userId: string): Promise<void> {
  await redis.del(wsKey(userId));
}

export async function isWsOnline(redis: Redis, userId: string): Promise<boolean> {
  const v = await redis.get(wsKey(userId));
  return v === "1";
}
