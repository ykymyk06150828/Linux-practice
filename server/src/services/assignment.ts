import type { PrismaClient } from "@prisma/client";
import { ContainerAssignmentStatus } from "@prisma/client";
import type { AppConfig } from "../config.js";
import {
  createLearnerContainer,
  getDocker,
  stopAndRemoveContainer,
} from "./docker-runtime.js";
import { withLearnerContainerLock } from "./learner-container-lock.js";

function containerNameForUser(userId: string): string {
  return `linuxtrainer-${userId}`;
}

/** ターミナル活動のたびに DB を叩きすぎないよう間引き */
export const CONTAINER_ACCESS_TOUCH_MIN_MS = 30_000;

/**
 * ターミナルで入出力があるたびに呼ぶ。`since.lastTouchMs` で間引き更新する。
 */
export async function touchContainerAssignmentLastAccessIfDue(
  prisma: PrismaClient,
  userId: string,
  since: { lastTouchMs: number },
): Promise<void> {
  const now = Date.now();
  if (now - since.lastTouchMs < CONTAINER_ACCESS_TOUCH_MIN_MS) return;
  since.lastTouchMs = now;
  await prisma.containerAssignment.updateMany({
    where: { userId, status: ContainerAssignmentStatus.running },
    data: { lastAccessAt: new Date() },
  });
}

/**
 * セッション終了時: Docker コンテナを停止・削除し、DB の割当行を削除する。
 * 次回ターミナル接続時に ensureLearnerContainer が新規作成する。
 */
export async function releaseLearnerContainerAssignment(
  prisma: PrismaClient,
  config: AppConfig,
  userId: string,
): Promise<void> {
  return withLearnerContainerLock(userId, async () => {
    const assignment = await prisma.containerAssignment.findUnique({
      where: { userId },
    });
    if (!assignment) return;
    if (assignment.containerId) {
      try {
        await stopAndRemoveContainer(config, assignment.containerId);
      } catch {
        /* ignore */
      }
    }
    await prisma.containerAssignment.delete({
      where: { userId },
    });
  });
}

export async function ensureLearnerContainer(
  prisma: PrismaClient,
  config: AppConfig,
  userId: string,
  taskId: string | null,
): Promise<{ assignmentId: string; containerId: string }> {
  return withLearnerContainerLock(userId, async () => {
    const name = containerNameForUser(userId);
    let assignment = await prisma.containerAssignment.findUnique({ where: { userId } });

    if (assignment?.containerId && assignment.status === ContainerAssignmentStatus.running) {
      try {
        await getDocker(config).getContainer(assignment.containerId).inspect();
        return { assignmentId: assignment.id, containerId: assignment.containerId };
      } catch {
        // コンテナが失われている場合は再作成
      }
    }

    if (assignment?.containerId) {
      await stopAndRemoveContainer(config, assignment.containerId);
    }

    await prisma.containerAssignment.upsert({
      where: { userId },
      create: {
        userId,
        taskId,
        containerName: name,
        status: ContainerAssignmentStatus.creating,
      },
      update: {
        taskId,
        containerId: null,
        status: ContainerAssignmentStatus.creating,
        containerName: name,
      },
    });

    const { id: containerId } = await createLearnerContainer(config, {
      name,
      image: config.LEARNER_IMAGE,
    });

    assignment = await prisma.containerAssignment.update({
      where: { userId },
      data: {
        containerId,
        status: ContainerAssignmentStatus.running,
        lastAccessAt: new Date(),
      },
    });

    return { assignmentId: assignment.id, containerId };
  });
}

export async function resetLearnerEnvironment(
  prisma: PrismaClient,
  config: AppConfig,
  userId: string,
  taskId: string | null,
): Promise<{ assignmentId: string }> {
  return withLearnerContainerLock(userId, async () => {
    const existing = await prisma.containerAssignment.findUnique({ where: { userId } });
    if (existing?.containerId) {
      await stopAndRemoveContainer(config, existing.containerId);
    }

    await prisma.containerAssignment.upsert({
      where: { userId },
      create: {
        userId,
        taskId,
        containerName: containerNameForUser(userId),
        status: ContainerAssignmentStatus.creating,
      },
      update: {
        taskId,
        containerId: null,
        status: ContainerAssignmentStatus.creating,
      },
    });

    const { id: containerId } = await createLearnerContainer(config, {
      name: containerNameForUser(userId),
      image: config.LEARNER_IMAGE,
    });

    const assignment = await prisma.containerAssignment.update({
      where: { userId },
      data: {
        containerId,
        status: ContainerAssignmentStatus.running,
        lastAccessAt: new Date(),
      },
    });

    return { assignmentId: assignment.id };
  });
}
