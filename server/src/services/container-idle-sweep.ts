import type { PrismaClient } from "@prisma/client";
import { ContainerAssignmentStatus } from "@prisma/client";
import type { AppConfig } from "../config.js";
import { isWsOnline } from "../lib/sessions.js";
import type { Redis } from "ioredis";
import { releaseLearnerContainerAssignment } from "./assignment.js";
import { disconnectUserWs } from "../ws/terminal.js";

/**
 * ログイン中でも、ターミナル未接続で最終アクセスが古いコンテナを解放する。
 * WS 接続中は Redis の ws キーがあり解放しない（ターミナル利用中にコンテナを消さない）。
 */
export async function sweepIdleLearnerContainers(
  prisma: PrismaClient,
  config: AppConfig,
  redis: Redis,
): Promise<{ released: number }> {
  const ttlSec = config.LEARNER_CONTAINER_IDLE_RELEASE_SEC;
  if (ttlSec <= 0) return { released: 0 };

  const cutoff = new Date(Date.now() - ttlSec * 1000);
  const rows = await prisma.containerAssignment.findMany({
    where: {
      status: ContainerAssignmentStatus.running,
      containerId: { not: null },
      OR: [{ lastAccessAt: null }, { lastAccessAt: { lt: cutoff } }],
    },
    select: { userId: true },
  });

  let released = 0;
  for (const { userId } of rows) {
    if (await isWsOnline(redis, userId)) continue;
    disconnectUserWs(userId);
    await releaseLearnerContainerAssignment(prisma, config, userId);
    released++;
  }
  return { released };
}
