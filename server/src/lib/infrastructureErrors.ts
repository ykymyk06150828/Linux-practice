import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError,
} from "@prisma/client/runtime/library";
import { ApiError } from "./errors.js";

/** DB 到達不能など（P1001, P1002, P1003） */
const DB_UNREACHABLE = new Set(["P1001", "P1002", "P1003"]);

export function mapInfrastructureError(err: unknown): ApiError | null {
  if (err instanceof PrismaClientInitializationError) {
    return new ApiError(
      503,
      "SERVICE_UNAVAILABLE",
      "データベースに接続できません。PostgreSQL が起動し、DATABASE_URL が正しいか確認してください。",
    );
  }
  if (err instanceof PrismaClientKnownRequestError && DB_UNREACHABLE.has(err.code)) {
    return new ApiError(
      503,
      "SERVICE_UNAVAILABLE",
      "データベースに接続できません。PostgreSQL が起動し、DATABASE_URL が正しいか確認してください。",
    );
  }
  if (err instanceof Error) {
    const m = err.message;
    if (m.includes("ECONNREFUSED") && (m.includes("6379") || /:6379\b/.test(m))) {
      return new ApiError(
        503,
        "SERVICE_UNAVAILABLE",
        "Redis に接続できません。Redis が起動し、REDIS_URL が正しいか確認してください。",
      );
    }
  }
  return null;
}
