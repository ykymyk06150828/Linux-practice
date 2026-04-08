import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import * as argon2 from "argon2";
import { Prisma } from "@prisma/client";
import type { Role } from "@prisma/client";
import type { AppConfig } from "./config.js";
import { ApiError, errorBody } from "./lib/errors.js";
import { mapInfrastructureError } from "./lib/infrastructureErrors.js";
import { prisma } from "./lib/prisma.js";
import { getRedis } from "./lib/redis.js";
import { createSession, deleteSession, isWsOnline } from "./lib/sessions.js";
import { createAuthHooks } from "./hooks.js";
import { disconnectUserWs, registerTerminalWs } from "./ws/terminal.js";
import {
  releaseLearnerContainerAssignment,
  resetLearnerEnvironment,
} from "./services/assignment.js";
import { sweepIdleLearnerContainers } from "./services/container-idle-sweep.js";
import { stopAndRemoveContainer } from "./services/docker-runtime.js";
import { importUsersFromCsv } from "./lib/csvUserImport.js";
import { normalizeLoginId } from "./lib/loginId.js";
import { getClientIp } from "./lib/clientIp.js";
import { applyApiSecurityHeaders } from "./lib/securityHeaders.js";
import {
  assertGlobalApiRateLimit,
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
} from "./lib/rateLimitRedis.js";
import { z } from "zod";

export async function buildApp(config: AppConfig) {
  const redis = getRedis(config);
  const hooks = createAuthHooks(config, redis);

  const app = Fastify({
    logger: true,
    trustProxy: config.TRUST_PROXY,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: config.FRONTEND_ORIGIN ?? true,
    credentials: true,
  });
  await app.register(websocket);

  app.addHook("onSend", async (_req, reply, payload) => {
    applyApiSecurityHeaders(reply);
    return payload;
  });

  app.addHook("onRequest", async (req) => {
    const path = req.url.split("?")[0] ?? "";
    if (!path.startsWith("/api")) return;
    if (path === "/api/health" || path === "/api/ready") return;
    await assertGlobalApiRateLimit(redis, getClientIp(req), config);
  });

  app.addHook("onRequest", hooks.loadSession);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      if (err.statusCode === 429) {
        const r = err.details?.retry_after_sec;
        if (typeof r === "number" && r > 0) {
          reply.header(
            "Retry-After",
            String(Math.min(Math.ceil(r), 86_400)),
          );
        }
      }
      return reply.status(err.statusCode).send(errorBody(err));
    }
    const infra = mapInfrastructureError(err);
    if (infra) {
      req.log.warn({ err }, "infrastructure unavailable");
      return reply.status(infra.statusCode).send(errorBody(infra));
    }
    req.log.error(err);
    return reply.status(500).send(
      errorBody(
        new ApiError(500, "INTERNAL", "内部エラーが発生しました"),
      ),
    );
  });

  app.post("/api/auth/login", async (req, reply) => {
    const ip = getClientIp(req);
    await assertLoginAllowed(redis, ip, config);
    const body = z
      .object({ login_id: z.string().min(1), password: z.string().min(1) })
      .parse(req.body);
    const loginKey = normalizeLoginId(body.login_id);
    const user = await prisma.user.findFirst({
      where: {
        loginId: { equals: loginKey, mode: "insensitive" as const },
      },
    });
    if (!user || user.status === "disabled") {
      await recordLoginFailure(redis, ip, config);
      throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "ID またはパスワードが正しくありません");
    }
    const ok = await argon2.verify(user.passwordHash, body.password);
    if (!ok) {
      await recordLoginFailure(redis, ip, config);
      throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "ID またはパスワードが正しくありません");
    }
    await clearLoginFailures(redis, ip);
    /** 別タブのターミナル WS を切る（軽量）。コンテナ解放はログアウト / アイドルスイープに任せ、ログイン応答を Docker 待ちにしない */
    disconnectUserWs(user.id);
    const sessionId = await createSession(redis, config, {
      userId: user.id,
      loginId: user.loginId,
      role: user.role,
    });
    reply.setCookie(config.SESSION_COOKIE_NAME, sessionId, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: config.NODE_ENV === "production",
      maxAge: config.SESSION_TTL_SEC,
    });
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_SEC * 1000).toISOString();
    return {
      user: {
        id: user.id,
        login_id: user.loginId,
        user_name: user.userName,
        role: user.role as Role,
      },
      expires_at: expiresAt,
    };
  });

  app.post(
    "/api/auth/logout",
    { preHandler: [hooks.requireAuth] },
    async (req, reply) => {
      const userId = req.session!.userId;
      const sid = req.cookies[config.SESSION_COOKIE_NAME] as string | undefined;
      disconnectUserWs(userId);
      await releaseLearnerContainerAssignment(prisma, config, userId);
      await deleteSession(redis, sid);
      reply.clearCookie(config.SESSION_COOKIE_NAME, { path: "/" });
      return reply.code(204).send();
    },
  );

  app.get("/api/auth/me", { preHandler: [hooks.requireAuth] }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.session!.userId },
    });
    return {
      user: {
        id: user.id,
        login_id: user.loginId,
        user_name: user.userName,
        role: user.role,
      },
    };
  });

  /** 受講者画面・演習 API。管理者も受講者と同じ操作で確認できるようにする */
  const learnerOrAdmin = [hooks.requireAuth, hooks.requireRole("learner", "admin")];

  /** コースごとの課題総数と、ログインユーザーが完了済みの件数 */
  async function taskProgressByCourse(
    userId: string,
    courseIds: string[],
  ): Promise<Map<string, { task_total: number; task_completed: number }>> {
    const map = new Map<string, { task_total: number; task_completed: number }>();
    for (const id of courseIds) {
      map.set(id, { task_total: 0, task_completed: 0 });
    }
    if (courseIds.length === 0) return map;

    const tasks = await prisma.task.findMany({
      where: { courseId: { in: courseIds } },
      select: { id: true, courseId: true },
    });
    const taskIds = tasks.map((t) => t.id);
    const completions =
      taskIds.length === 0
        ? []
        : await prisma.userTaskCompletion.findMany({
            where: { userId, taskId: { in: taskIds } },
            select: { taskId: true },
          });
    const done = new Set(completions.map((c) => c.taskId));

    for (const t of tasks) {
      const row = map.get(t.courseId)!;
      row.task_total += 1;
      if (done.has(t.id)) row.task_completed += 1;
    }
    return map;
  }

  app.get("/api/course/current", { preHandler: learnerOrAdmin }, async (req) => {
    type CourseOut = {
      id: string;
      course_name: string;
      description: string;
      task_total: number;
      task_completed: number;
    };
    let courses: CourseOut[];

    if (req.session!.role === "admin") {
      const rows = await prisma.course.findMany({
        where: { status: "active" },
        orderBy: { updatedAt: "desc" },
      });
      const ids = rows.map((c) => c.id);
      const progress = await taskProgressByCourse(req.session!.userId, ids);
      courses = rows.map((c) => {
        const p = progress.get(c.id)!;
        return {
          id: c.id,
          course_name: c.courseName,
          description: c.description ?? "",
          task_total: p.task_total,
          task_completed: p.task_completed,
        };
      });
    } else {
      const enrollments = await prisma.userCourseEnrollment.findMany({
        where: {
          userId: req.session!.userId,
          course: { status: "active" },
        },
        include: { course: true },
        orderBy: { createdAt: "asc" },
      });
      const ids = enrollments.map((e) => e.courseId);
      const progress = await taskProgressByCourse(req.session!.userId, ids);
      courses = enrollments.map((e) => {
        const p = progress.get(e.courseId)!;
        return {
          id: e.course.id,
          course_name: e.course.courseName,
          description: e.course.description ?? "",
          task_total: p.task_total,
          task_completed: p.task_completed,
        };
      });
    }

    const first = courses[0];
    return {
      courses,
      /** 後方互換: 先頭のコース */
      course: first
        ? {
            id: first.id,
            course_name: first.course_name,
            description: first.description,
            task_total: first.task_total,
            task_completed: first.task_completed,
          }
        : null,
    };
  });

  app.get("/api/task/list", { preHandler: learnerOrAdmin }, async (req) => {
    const q = z
      .object({ course_id: z.string().uuid().optional() })
      .parse(req.query);
    type Row = { courseId: string; courseName: string };
    let rows: Row[];
    if (req.session!.role === "admin") {
      const all = await prisma.course.findMany({
        where: { status: "active" },
        orderBy: { updatedAt: "desc" },
      });
      rows = all.map((c) => ({ courseId: c.id, courseName: c.courseName }));
    } else {
      const enrollments = await prisma.userCourseEnrollment.findMany({
        where: {
          userId: req.session!.userId,
          course: { status: "active" },
        },
        include: { course: true },
        orderBy: { createdAt: "asc" },
      });
      rows = enrollments.map((e) => ({
        courseId: e.courseId,
        courseName: e.course.courseName,
      }));
    }

    const buildBlock = async (
      courseId: string,
      courseName: string,
    ) => {
      const tasks = await prisma.task.findMany({
        where: { courseId },
        orderBy: { displayOrder: "asc" },
      });
      const taskIds = tasks.map((t) => t.id);
      const completions =
        taskIds.length === 0
          ? []
          : await prisma.userTaskCompletion.findMany({
              where: {
                userId: req.session!.userId,
                taskId: { in: taskIds },
              },
              select: { taskId: true },
            });
      const done = new Set(completions.map((c) => c.taskId));
      return {
        course_id: courseId,
        course_name: courseName,
        tasks: tasks.map((t) => ({
          id: t.id,
          task_name: t.taskName,
          description: t.description ?? "",
          display_order: t.displayOrder,
          completed: done.has(t.id),
        })),
      };
    };

    let filtered = rows;
    if (q.course_id) {
      filtered = rows.filter((r) => r.courseId === q.course_id);
      if (filtered.length === 0) {
        return { courses: [], tasks: [] };
      }
    }

    const coursesOut = await Promise.all(
      filtered.map((r) => buildBlock(r.courseId, r.courseName)),
    );
    const flatTasks = coursesOut.flatMap((c) => c.tasks);
    return { courses: coursesOut, tasks: flatTasks };
  });

  app.post("/api/task/complete", { preHandler: learnerOrAdmin }, async (req) => {
    const body = z.object({ task_id: z.string().uuid() }).parse(req.body);
    const task = await prisma.task.findUnique({
      where: { id: body.task_id },
      select: { id: true, courseId: true },
    });
    if (!task) {
      throw new ApiError(404, "NOT_FOUND", "課題が見つかりません");
    }
    if (req.session!.role === "learner") {
      const enrollment = await prisma.userCourseEnrollment.findUnique({
        where: {
          userId_courseId: {
            userId: req.session!.userId,
            courseId: task.courseId,
          },
        },
      });
      if (!enrollment) {
        throw new ApiError(403, "FORBIDDEN", "このコースは受講登録されていません");
      }
    }
    await prisma.userTaskCompletion.upsert({
      where: {
        userId_taskId: {
          userId: req.session!.userId,
          taskId: task.id,
        },
      },
      create: {
        userId: req.session!.userId,
        taskId: task.id,
      },
      update: {},
    });
    return { ok: true as const };
  });

  app.post("/api/task/uncomplete", { preHandler: learnerOrAdmin }, async (req) => {
    const body = z.object({ task_id: z.string().uuid() }).parse(req.body);
    const task = await prisma.task.findUnique({
      where: { id: body.task_id },
      select: { id: true, courseId: true },
    });
    if (!task) {
      throw new ApiError(404, "NOT_FOUND", "課題が見つかりません");
    }
    if (req.session!.role === "learner") {
      const enrollment = await prisma.userCourseEnrollment.findUnique({
        where: {
          userId_courseId: {
            userId: req.session!.userId,
            courseId: task.courseId,
          },
        },
      });
      if (!enrollment) {
        throw new ApiError(403, "FORBIDDEN", "このコースは受講登録されていません");
      }
    }
    await prisma.userTaskCompletion.deleteMany({
      where: {
        userId: req.session!.userId,
        taskId: task.id,
      },
    });
    return { ok: true as const };
  });

  app.get("/api/environment/status", { preHandler: learnerOrAdmin }, async (req) => {
    const a = await prisma.containerAssignment.findUnique({
      where: { userId: req.session!.userId },
    });
    const ws = await isWsOnline(redis, req.session!.userId);
    if (!a) {
      return { assignment: null, websocket_connected: ws };
    }
    return {
      assignment: {
        container_id: a.containerId ?? "",
        container_name: a.containerName,
        status: a.status.toLowerCase(),
        last_access_at: a.lastAccessAt?.toISOString() ?? null,
      },
      websocket_connected: ws,
    };
  });

  app.post(
    "/api/environment/reset",
    { preHandler: learnerOrAdmin },
    async (req, reply) => {
      const body = z
        .object({ task_id: z.string().uuid().optional() })
        .parse(req.body ?? {});
      const { assignmentId } = await resetLearnerEnvironment(
        prisma,
        config,
        req.session!.userId,
        body.task_id ?? null,
      );
      reply.status(202);
      return { status: "accepted", assignment_id: assignmentId };
    },
  );

  const adminOnly = [hooks.requireAuth, hooks.requireRole("admin")];

  app.get("/api/admin/users", { preHandler: adminOnly }, async (req) => {
    const q = z
      .object({
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(20),
        role: z.enum(["learner", "admin"]).optional(),
        q: z.string().optional(),
      })
      .parse(req.query);
    const where = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.q
        ? {
            OR: [
              { loginId: { contains: q.q, mode: "insensitive" as const } },
              { userName: { contains: q.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const total = await prisma.user.count({ where });
    const users = await prisma.user.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { loginId: "asc" },
      include: { assignments: true },
    });
    const out = await Promise.all(
      users.map(async (u) => {
        const online = await isWsOnline(redis, u.id);
        const a = u.assignments[0];
        return {
          id: u.id,
          login_id: u.loginId,
          user_name: u.userName,
          role: u.role,
          status: u.status,
          connection: {
            state: online ? "online" : "offline",
            last_seen_at: a?.lastAccessAt?.toISOString() ?? null,
          },
          assignment: a
            ? {
                container_id: a.containerId,
                container_name: a.containerName,
                status: a.status,
              }
            : null,
        };
      }),
    );
    return { users: out, total };
  });

  app.get("/api/admin/users/:userId", { preHandler: adminOnly }, async (req) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiError(404, "NOT_FOUND", "ユーザーが見つかりません");
    const enrollments = await prisma.userCourseEnrollment.findMany({
      where: { userId },
      include: { course: true },
      orderBy: { createdAt: "asc" },
    });
    const assignment = await prisma.containerAssignment.findUnique({
      where: { userId },
    });
    const connection_logs = await prisma.connectionLog.findMany({
      where: { userId },
      orderBy: { connectedAt: "desc" },
      take: 20,
    });
    return {
      user: {
        id: user.id,
        login_id: user.loginId,
        user_name: user.userName,
        role: user.role,
        status: user.status,
      },
      enrollments: enrollments.map((e) => ({
        course_id: e.courseId,
        course_name: e.course.courseName,
      })),
      assignment,
      connection_logs: connection_logs.map((c) => ({
        connected_at: c.connectedAt.toISOString(),
        disconnected_at: c.disconnectedAt?.toISOString() ?? null,
      })),
    };
  });

  app.patch(
    "/api/admin/users/:userId",
    { preHandler: adminOnly },
    async (req) => {
      const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
      const body = z
        .object({
          login_id: z.string().min(1).max(64),
          user_name: z.string().min(1).max(200),
          role: z.enum(["learner", "admin"]),
        })
        .parse(req.body);
      const target = await prisma.user.findUnique({ where: { id: userId } });
      if (!target) {
        throw new ApiError(404, "NOT_FOUND", "ユーザーが見つかりません");
      }
      const loginId = normalizeLoginId(body.login_id);
      const dup = await prisma.user.findFirst({
        where: {
          loginId: { equals: loginId, mode: "insensitive" as const },
          NOT: { id: userId },
        },
      });
      if (dup) {
        throw new ApiError(409, "CONFLICT", "このログイン ID は既に使われています");
      }
      if (target.role === "admin" && body.role !== "admin") {
        const adminCount = await prisma.user.count({ where: { role: "admin" } });
        if (adminCount <= 1) {
          throw new ApiError(
            400,
            "BAD_REQUEST",
            "最後の管理者のロールを受講者に変更することはできません",
          );
        }
      }
      const userName = body.user_name.trim();
      try {
        await prisma.user.update({
          where: { id: userId },
          data: {
            loginId,
            userName,
            role: body.role as Role,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new ApiError(409, "CONFLICT", "このログイン ID は既に使われています");
        }
        throw e;
      }
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: req.session!.userId,
          targetUserId: userId,
          actionType: "user.update",
          actionResult: "ok",
          detail: { login_id: loginId, user_name: userName, role: body.role },
        },
      });
      return {
        user: {
          id: userId,
          login_id: loginId,
          user_name: userName,
          role: body.role,
          status: target.status,
        },
      };
    },
  );

  app.put(
    "/api/admin/users/:userId/enrollments",
    { preHandler: adminOnly },
    async (req) => {
      const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
      const body = z
        .object({ course_ids: z.array(z.string().uuid()).max(100) })
        .parse(req.body);
      const target = await prisma.user.findUnique({ where: { id: userId } });
      if (!target) throw new ApiError(404, "NOT_FOUND", "ユーザーが見つかりません");
      if (target.role !== "learner") {
        throw new ApiError(
          400,
          "BAD_REQUEST",
          "受講者アカウントのみコースを紐付けできます",
        );
      }
      const uniqueIds = [...new Set(body.course_ids)];
      if (uniqueIds.length > 0) {
        const found = await prisma.course.findMany({
          where: { id: { in: uniqueIds }, status: "active" },
        });
        if (found.length !== uniqueIds.length) {
          throw new ApiError(
            400,
            "BAD_REQUEST",
            "存在しない、またはアーカイブ済みのコース ID が含まれています",
          );
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.userCourseEnrollment.deleteMany({ where: { userId } });
        if (uniqueIds.length === 0) return;
        await tx.userCourseEnrollment.createMany({
          data: uniqueIds.map((courseId) => ({ userId, courseId })),
        });
      });
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: req.session!.userId,
          targetUserId: userId,
          actionType: "user.enrollments",
          actionResult: "ok",
          detail: { course_ids: uniqueIds },
        },
      });
      return { ok: true };
    },
  );

  app.get("/api/admin/containers", { preHandler: adminOnly }, async (req) => {
    const q = z
      .object({
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(20),
        status: z.string().optional(),
      })
      .parse(req.query);
    const where = q.status
      ? { status: q.status as "creating" | "running" | "stopped" | "error" }
      : {};
    const total = await prisma.containerAssignment.count({ where });
    const rows = await prisma.containerAssignment.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { updatedAt: "desc" },
      include: { user: true },
    });
    return {
      containers: rows.map((r) => ({
        container_id: r.containerId,
        container_name: r.containerName,
        user_id: r.userId,
        login_id: r.user.loginId,
        user_name: r.user.userName,
        status: r.status,
        cpu_percent: null,
        mem_usage_bytes: null,
        started_at: r.createdAt.toISOString(),
        last_access_at: r.lastAccessAt?.toISOString() ?? null,
      })),
      total,
    };
  });

  app.get("/api/admin/logs", { preHandler: adminOnly }, async (req) => {
    const q = z
      .object({
        type: z.string().optional(),
        user_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(50),
      })
      .parse(req.query);
    const whereAudit: Record<string, unknown> = {};
    if (q.user_id) whereAudit.targetUserId = q.user_id;
    const logs = await prisma.adminAuditLog.findMany({
      where: whereAudit,
      orderBy: { executedAt: "desc" },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    });
    const total = await prisma.adminAuditLog.count({ where: whereAudit });
    return {
      logs: logs.map((l) => ({
        timestamp: l.executedAt.toISOString(),
        type: q.type ?? "audit",
        message: l.actionType,
        result: l.actionResult,
        metadata: l.detail ?? {},
      })),
      total,
    };
  });

  app.post(
    "/api/admin/environment/reset",
    { preHandler: adminOnly },
    async (req, reply) => {
      const body = z.object({ user_id: z.string().uuid() }).parse(req.body);
      const { assignmentId } = await resetLearnerEnvironment(
        prisma,
        config,
        body.user_id,
        null,
      );
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: req.session!.userId,
          targetUserId: body.user_id,
          actionType: "environment.reset",
          actionResult: "ok",
        },
      });
      reply.status(202);
      return { status: "accepted", assignment_id: assignmentId };
    },
  );

  app.post("/api/admin/environment/stop", { preHandler: adminOnly }, async (req, reply) => {
    const body = z
      .object({
        user_id: z.string().uuid(),
        action: z.enum(["stop", "remove"]),
      })
      .parse(req.body);
    const a = await prisma.containerAssignment.findUnique({
      where: { userId: body.user_id },
    });
    if (a?.containerId) {
      await stopAndRemoveContainer(config, a.containerId);
    }
    await prisma.containerAssignment.updateMany({
      where: { userId: body.user_id },
      data: { status: "stopped", containerId: null },
    });
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.session!.userId,
        targetUserId: body.user_id,
        actionType: `environment.${body.action}`,
        actionResult: "ok",
      },
    });
    return reply.code(204).send();
  });

  app.post(
    "/api/admin/users/:userId/disconnect",
    { preHandler: adminOnly },
    async (req, reply) => {
      const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
      disconnectUserWs(userId);
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: req.session!.userId,
          targetUserId: userId,
          actionType: "user.disconnect",
          actionResult: "ok",
        },
      });
      return reply.code(204).send();
    },
  );

  app.get("/api/admin/courses/count", { preHandler: adminOnly }, async () => {
    const total = await prisma.course.count();
    return { total };
  });

  app.get("/api/admin/courses", { preHandler: adminOnly }, async () => {
    const courses = await prisma.course.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { tasks: true, enrollments: true } },
      },
    });
    return {
      total: courses.length,
      courses: courses.map((c) => ({
        id: c.id,
        course_name: c.courseName,
        description: c.description ?? "",
        status: c.status,
        task_count: c._count.tasks,
        enrollment_count: c._count.enrollments,
        updated_at: c.updatedAt.toISOString(),
      })),
    };
  });

  app.get("/api/admin/courses/:courseId", { preHandler: adminOnly }, async (req) => {
    const { courseId } = z.object({ courseId: z.string().uuid() }).parse(req.params);
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        tasks: { orderBy: { displayOrder: "asc" } },
      },
    });
    if (!course) {
      throw new ApiError(404, "NOT_FOUND", "コースが見つかりません");
    }
    return {
      course: {
        id: course.id,
        course_name: course.courseName,
        description: course.description ?? "",
        status: course.status,
      },
      tasks: course.tasks.map((t) => ({
        id: t.id,
        task_name: t.taskName,
        description: t.description ?? "",
        display_order: t.displayOrder,
      })),
    };
  });

  /** コース受講者ごとの課題完了状況（管理者用） */
  app.get(
    "/api/admin/courses/:courseId/progress",
    { preHandler: adminOnly },
    async (req) => {
      const { courseId } = z.object({ courseId: z.string().uuid() }).parse(req.params);
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: {
          tasks: { select: { id: true } },
          enrollments: {
            include: {
              user: {
                select: {
                  id: true,
                  loginId: true,
                  userName: true,
                  role: true,
                  status: true,
                },
              },
            },
          },
        },
      });
      if (!course) {
        throw new ApiError(404, "NOT_FOUND", "コースが見つかりません");
      }
      const taskIds = course.tasks.map((t) => t.id);
      const taskCount = taskIds.length;

      const completedByUser = new Map<string, number>();
      if (taskCount > 0) {
        const completions = await prisma.userTaskCompletion.groupBy({
          by: ["userId"],
          where: { taskId: { in: taskIds } },
          _count: { taskId: true },
        });
        for (const row of completions) {
          completedByUser.set(row.userId, row._count.taskId);
        }
      }

      const users = course.enrollments
        .slice()
        .sort((a, b) =>
          a.user.loginId.localeCompare(b.user.loginId, "ja", { sensitivity: "base" }),
        )
        .map((e) => ({
          user_id: e.user.id,
          login_id: e.user.loginId,
          user_name: e.user.userName,
          role: e.user.role,
          user_status: e.user.status,
          completed_count: completedByUser.get(e.user.id) ?? 0,
          total_tasks: taskCount,
        }));

      return {
        course_id: course.id,
        task_count: taskCount,
        users,
      };
    },
  );

  app.post(
    "/api/admin/courses/:courseId/tasks",
    { preHandler: adminOnly },
    async (req, reply) => {
      const { courseId } = z.object({ courseId: z.string().uuid() }).parse(req.params);
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) {
        throw new ApiError(404, "NOT_FOUND", "コースが見つかりません");
      }
      if (course.status === "archived") {
        throw new ApiError(
          400,
          "BAD_REQUEST",
          "アーカイブ済みのコースには課題を追加できません。有効化してから操作してください。",
        );
      }
      const body = z
        .object({
          task_name: z.string().min(1).max(200),
          description: z.string().max(4000).optional().nullable(),
          /** 省略時は末尾。指定時はこの位置に挿入し、既存の同値以上を +1 して重複しない */
          display_order: z.number().int().min(1).optional(),
        })
        .parse(req.body);
      const task = await prisma.$transaction(async (tx) => {
        let displayOrder: number;
        if (body.display_order !== undefined) {
          const insertAt = body.display_order;
          await tx.task.updateMany({
            where: { courseId, displayOrder: { gte: insertAt } },
            data: { displayOrder: { increment: 1 } },
          });
          displayOrder = insertAt;
        } else {
          const maxOrder = await tx.task.aggregate({
            where: { courseId },
            _max: { displayOrder: true },
          });
          displayOrder = (maxOrder._max.displayOrder ?? 0) + 1;
        }
        return tx.task.create({
          data: {
            courseId,
            taskName: body.task_name.trim(),
            description: body.description?.trim() || null,
            displayOrder,
          },
        });
      });
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: req.session!.userId,
          actionType: "task.create",
          actionResult: "ok",
          detail: { course_id: courseId, task_id: task.id },
        },
      });
      reply.status(201);
      return {
        task: {
          id: task.id,
          task_name: task.taskName,
          description: task.description ?? "",
          display_order: task.displayOrder,
        },
      };
    },
  );

  app.post(
    "/api/admin/courses/:courseId/tasks/bulk",
    { preHandler: adminOnly },
    async (req, reply) => {
      const { courseId } = z.object({ courseId: z.string().uuid() }).parse(req.params);
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) {
        throw new ApiError(404, "NOT_FOUND", "コースが見つかりません");
      }
      if (course.status === "archived") {
        throw new ApiError(
          400,
          "BAD_REQUEST",
          "アーカイブ済みのコースには課題を追加できません。有効化してから操作してください。",
        );
      }
      const body = z
        .object({
          tasks: z
            .array(
              z.object({
                task_name: z.string().min(1).max(200),
                description: z.string().max(4000).optional().nullable(),
              }),
            )
            .min(1)
            .max(200),
        })
        .parse(req.body);

      const normalized = body.tasks.map((t) => ({
        taskName: t.task_name.trim(),
        description: t.description?.trim() ? t.description.trim() : null,
      }));

      const created = await prisma.$transaction(async (tx) => {
        const maxOrder = await tx.task.aggregate({
          where: { courseId },
          _max: { displayOrder: true },
        });
        let next = (maxOrder._max.displayOrder ?? 0) + 1;
        const rows: { id: string; taskName: string; description: string | null; displayOrder: number }[] = [];
        for (const row of normalized) {
          const t = await tx.task.create({
            data: {
              courseId,
              taskName: row.taskName,
              description: row.description,
              displayOrder: next,
            },
          });
          next += 1;
          rows.push({
            id: t.id,
            taskName: t.taskName,
            description: t.description,
            displayOrder: t.displayOrder,
          });
        }
        return rows;
      });

      await prisma.adminAuditLog.create({
        data: {
          adminUserId: req.session!.userId,
          actionType: "task.bulk_create",
          actionResult: "ok",
          detail: { course_id: courseId, count: created.length },
        },
      });

      reply.status(201);
      return {
        created: created.length,
        tasks: created.map((t) => ({
          id: t.id,
          task_name: t.taskName,
          description: t.description ?? "",
          display_order: t.displayOrder,
        })),
      };
    },
  );

  app.patch("/api/admin/tasks/:taskId", { preHandler: adminOnly }, async (req) => {
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        task_name: z.string().min(1).max(200).optional(),
        description: z.string().max(4000).optional().nullable(),
        display_order: z.number().int().min(1).optional(),
      })
      .parse(req.body);
    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      include: { course: true },
    });
    if (!existing) {
      throw new ApiError(404, "NOT_FOUND", "タスクが見つかりません");
    }
    if (existing.course.status === "archived") {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "アーカイブ済みコースの課題は編集できません。",
      );
    }
    const courseId = existing.courseId;
    const oldOrder = existing.displayOrder;
    const task = await prisma.$transaction(async (tx) => {
      if (
        body.display_order !== undefined &&
        body.display_order !== oldOrder
      ) {
        const newP = body.display_order;
        if (newP < oldOrder) {
          await tx.task.updateMany({
            where: {
              courseId,
              displayOrder: { gte: newP, lt: oldOrder },
              NOT: { id: taskId },
            },
            data: { displayOrder: { increment: 1 } },
          });
        } else {
          await tx.task.updateMany({
            where: {
              courseId,
              displayOrder: { gt: oldOrder, lte: newP },
              NOT: { id: taskId },
            },
            data: { displayOrder: { increment: -1 } },
          });
        }
      }
      return tx.task.update({
        where: { id: taskId },
        data: {
          ...(body.task_name !== undefined
            ? { taskName: body.task_name.trim() }
            : {}),
          ...(body.description !== undefined
            ? { description: body.description?.trim() || null }
            : {}),
          ...(body.display_order !== undefined
            ? { displayOrder: body.display_order }
            : {}),
        },
      });
    });
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.session!.userId,
        actionType: "task.update",
        actionResult: "ok",
        detail: { task_id: task.id, course_id: task.courseId },
      },
    });
    return {
      task: {
        id: task.id,
        task_name: task.taskName,
        description: task.description ?? "",
        display_order: task.displayOrder,
      },
    };
  });

  app.delete("/api/admin/tasks/:taskId", { preHandler: adminOnly }, async (req, reply) => {
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(req.params);
    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      include: { course: true },
    });
    if (!existing) {
      throw new ApiError(404, "NOT_FOUND", "タスクが見つかりません");
    }
    if (existing.course.status === "archived") {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "アーカイブ済みコースの課題は削除できません。",
      );
    }
    const cid = existing.courseId;
    await prisma.task.delete({ where: { id: taskId } });
    const rest = await prisma.task.findMany({
      where: { courseId: cid },
      orderBy: { displayOrder: "asc" },
    });
    if (rest.length > 0) {
      await prisma.$transaction(
        rest.map((t, i) =>
          prisma.task.update({
            where: { id: t.id },
            data: { displayOrder: i + 1 },
          }),
        ),
      );
    }
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.session!.userId,
        actionType: "task.delete",
        actionResult: "ok",
        detail: { task_id: taskId, course_id: cid },
      },
    });
    return reply.code(204).send();
  });

  app.patch(
    "/api/admin/courses/:courseId",
    { preHandler: adminOnly },
    async (req) => {
      const { courseId } = z.object({ courseId: z.string().uuid() }).parse(req.params);
      const body = z
        .object({
          status: z.enum(["active", "archived"]).optional(),
          course_name: z.string().min(1).max(200).optional(),
          description: z.union([z.string().max(4000), z.null()]).optional(),
        })
        .refine(
          (b) =>
            b.status !== undefined ||
            b.course_name !== undefined ||
            b.description !== undefined,
          { message: "更新する項目がありません" },
        )
        .parse(req.body);
      const existing = await prisma.course.findUnique({ where: { id: courseId } });
      if (!existing) {
        throw new ApiError(404, "NOT_FOUND", "コースが見つかりません");
      }
      const data: {
        status?: "active" | "archived";
        courseName?: string;
        description?: string | null;
      } = {};
      if (body.status !== undefined) data.status = body.status;
      if (body.course_name !== undefined) data.courseName = body.course_name.trim();
      if (body.description !== undefined) {
        data.description =
          body.description === null ? null : body.description.trim() || null;
      }
      const course = await prisma.course.update({
        where: { id: courseId },
        data,
      });
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: req.session!.userId,
          actionType: "course.update",
          actionResult: "ok",
          detail: {
            course_id: course.id,
            course_name: course.courseName,
            status: course.status,
          },
        },
      });
      return {
        course: {
          id: course.id,
          course_name: course.courseName,
          description: course.description ?? "",
          status: course.status,
        },
      };
    },
  );

  app.post("/api/admin/courses", { preHandler: adminOnly }, async (req, reply) => {
    const body = z
      .object({
        course_name: z.string().min(1).max(200),
        description: z.string().max(4000).optional(),
        status: z.enum(["active", "archived"]).optional(),
      })
      .parse(req.body);
    const course = await prisma.course.create({
      data: {
        courseName: body.course_name.trim(),
        description: body.description?.trim() || null,
        status: body.status ?? "active",
      },
    });
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.session!.userId,
        actionType: "course.create",
        actionResult: "ok",
        detail: { course_id: course.id, course_name: course.courseName },
      },
    });
    reply.status(201);
    return {
      course: {
        id: course.id,
        course_name: course.courseName,
        description: course.description ?? "",
        status: course.status,
      },
    };
  });

  app.post("/api/admin/users/register", { preHandler: adminOnly }, async (req, reply) => {
    const body = z
      .object({
        login_id: z.string().min(1).max(64),
        user_name: z.string().min(1).max(200),
        password: z.string().min(8).max(128),
        role: z.enum(["learner", "admin"]),
        course_ids: z.array(z.string().uuid()).max(100).optional(),
        course_id: z.string().uuid().optional().nullable(),
      })
      .parse(req.body);
    const loginId = normalizeLoginId(body.login_id);
    const dup = await prisma.user.findFirst({
      where: { loginId: { equals: loginId, mode: "insensitive" as const } },
    });
    if (dup) {
      throw new ApiError(409, "CONFLICT", "このログイン ID は既に使われています");
    }
    const passwordHash = await argon2.hash(body.password);
    const user = await prisma.user.create({
      data: {
        loginId,
        userName: body.user_name.trim(),
        passwordHash,
        role: body.role,
        status: "active",
      },
    });
    if (user.role === "learner") {
      let ids = [...new Set(body.course_ids ?? [])];
      if (ids.length === 0 && body.course_id) {
        ids = [body.course_id];
      }
      if (ids.length === 0) {
        const firstActive = await prisma.course.findFirst({
          where: { status: "active" },
          orderBy: { createdAt: "asc" },
        });
        if (firstActive) ids = [firstActive.id];
      }
      if (ids.length > 0) {
        const found = await prisma.course.findMany({
          where: { id: { in: ids }, status: "active" },
        });
        if (found.length !== ids.length) {
          await prisma.user.delete({ where: { id: user.id } });
          throw new ApiError(
            404,
            "NOT_FOUND",
            "指定されたコースが見つからないか、有効ではありません",
          );
        }
        await prisma.userCourseEnrollment.createMany({
          data: ids.map((courseId) => ({ userId: user.id, courseId })),
        });
      }
    }

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.session!.userId,
        targetUserId: user.id,
        actionType: "user.create",
        actionResult: "ok",
        detail: { login_id: user.loginId, role: user.role },
      },
    });
    reply.status(201);
    return {
      user: {
        id: user.id,
        login_id: user.loginId,
        user_name: user.userName,
        role: user.role,
      },
    };
  });

  app.post(
    "/api/admin/users/import",
    { preHandler: adminOnly },
    async (req, reply) => {
      const body = z
        .object({ csv: z.string().max(2_000_000) })
        .parse(req.body);
      const result = await importUsersFromCsv(
        prisma,
        body.csv,
        (p) => argon2.hash(p),
        { adminUserId: req.session!.userId },
      );
      if (!result.ok) {
        throw new ApiError(400, "IMPORT_VALIDATION", "CSV にエラーがあります", {
          errors: result.errors,
        });
      }
      reply.status(201);
      return {
        ok: true,
        created: result.created,
        users: result.users,
      };
    },
  );

  app.post(
    "/api/admin/users/bulk-delete",
    { preHandler: adminOnly },
    async (req, reply) => {
      const body = z
        .object({
          user_ids: z.array(z.string().uuid()).min(1).max(100),
        })
        .parse(req.body);
      const ids = [...new Set(body.user_ids)];
      const selfId = req.session!.userId;
      if (ids.includes(selfId)) {
        throw new ApiError(
          400,
          "BAD_REQUEST",
          "自分自身のユーザーは削除できません",
        );
      }
      const admins = await prisma.user.findMany({
        where: { role: "admin" },
        select: { id: true },
      });
      const adminIds = new Set(admins.map((a) => a.id));
      const deletingAdmins = ids.filter((id) => adminIds.has(id));
      if (admins.length - deletingAdmins.length < 1) {
        throw new ApiError(
          400,
          "BAD_REQUEST",
          "最後の管理者アカウントは削除できません",
        );
      }
      const found = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      if (found.length !== ids.length) {
        throw new ApiError(
          404,
          "NOT_FOUND",
          "削除対象のユーザーが一部見つかりません",
        );
      }
      for (const uid of ids) {
        disconnectUserWs(uid);
        const a = await prisma.containerAssignment.findUnique({
          where: { userId: uid },
        });
        if (a?.containerId) {
          try {
            await stopAndRemoveContainer(config, a.containerId);
          } catch (err) {
            req.log.warn({ err, uid }, "container stop on bulk delete");
          }
        }
      }
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: selfId,
          actionType: "user.bulk_delete",
          actionResult: "ok",
          detail: { user_ids: ids, count: ids.length },
        },
      });
      return reply.code(204).send();
    },
  );

  app.get("/api/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  /** DB / Redis 疎通（監視・オーケストレーションの readiness 用）。失敗時は 503 */
  app.get("/api/ready", async (req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const pong = await redis.ping();
      if (pong !== "PONG") {
        throw new Error("Redis PING unexpected");
      }
      return {
        status: "ready",
        timestamp: new Date().toISOString(),
        checks: { database: "ok", redis: "ok" },
      };
    } catch (err) {
      req.log.warn({ err }, "readiness check failed");
      return reply.status(503).send(
        errorBody(
          new ApiError(
            503,
            "NOT_READY",
            "依存サービス（PostgreSQL / Redis）に接続できません",
          ),
        ),
      );
    }
  });

  registerTerminalWs(app, { config, redis });

  if (config.LEARNER_CONTAINER_IDLE_RELEASE_SEC > 0) {
    const sweepMs = 60_000;
    setInterval(() => {
      void sweepIdleLearnerContainers(prisma, config, redis)
        .then((r) => {
          if (r.released > 0) {
            app.log.info({ released: r.released }, "idle learner containers released");
          }
        })
        .catch((err: unknown) => {
          app.log.warn({ err }, "idle container sweep failed");
        });
    }, sweepMs);
  }

  return app;
}
