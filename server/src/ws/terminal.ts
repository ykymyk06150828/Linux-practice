import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { AppConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { getSession, markWsOffline, markWsOnline } from "../lib/sessions.js";
import { getTerminalLineBlockInfo } from "../services/command-policy.js";
import {
  ensureLearnerContainer,
  touchContainerAssignmentLastAccessIfDue,
} from "../services/assignment.js";
import { getDocker } from "../services/docker-runtime.js";
import type { Redis } from "ioredis";

const active = new Map<string, WebSocket>();

/** docker-modem が attach の POST ボディとして送り、TTY にエコーされうる JSON（dockerode #742） */
function looksLikeDockerodeAttachOptionsJson(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    o.stream === true &&
    o.stdin === true &&
    o.stdout === true &&
    o.hijack === true &&
    o.tty === true
  );
}

/**
 * ストリーム先頭の上記 JSON だけを除去（チャンク分割に対応）。該当しなければバッファをそのまま返す。
 */
function consumeLeadingDockerodeAttachNoise(
  pending: Buffer,
  chunk: Buffer,
): { pending: Buffer; emit: Buffer[] } {
  const combined = Buffer.concat([pending, chunk]);
  const text = combined.toString("utf8");
  const ws = text.match(/^\s*/)?.[0] ?? "";
  const wsLen = ws.length;
  const rest = text.slice(wsLen);
  const braceIdx = rest.indexOf("{");
  if (braceIdx < 0) {
    return { pending: Buffer.alloc(0), emit: combined.length > 0 ? [combined] : [] };
  }
  const absStart = wsLen + braceIdx;
  let depth = 0;
  let i = absStart;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  if (depth !== 0) {
    return { pending: combined, emit: [] };
  }
  const jsonStr = text.slice(absStart, i);
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (!looksLikeDockerodeAttachOptionsJson(parsed)) {
      return { pending: Buffer.alloc(0), emit: [combined] };
    }
    const tail = text.slice(i);
    return {
      pending: Buffer.alloc(0),
      emit: tail.length > 0 ? [Buffer.from(tail, "utf8")] : [],
    };
  } catch {
    return { pending: Buffer.alloc(0), emit: [combined] };
  }
}

export function disconnectUserWs(userId: string): void {
  const ws = active.get(userId);
  if (!ws) return;
  try {
    ws.send(
      JSON.stringify({
        type: "session.disconnected",
        reason: "admin_disconnect",
      }),
    );
  } catch {
    /* ignore */
  }
  ws.close();
}

export function registerTerminalWs(
  app: FastifyInstance,
  opts: { config: AppConfig; redis: Redis },
) {
  const { config, redis } = opts;

  app.get(
    "/ws/terminal",
    { websocket: true },
    async (socket, req) => {
      const sid = (req.cookies as Record<string, string | undefined>)[
        config.SESSION_COOKIE_NAME
      ];
      const session = await getSession(redis, sid);
      const canUseTerminal =
        session &&
        (session.role === "learner" || session.role === "admin");
      if (!canUseTerminal) {
        socket.send(
          JSON.stringify({
            type: "error",
            code: "WS_AUTH_REQUIRED",
            message: "受講者または管理者としてログインしてください",
          }),
        );
        socket.close();
        return;
      }

      const userId = session.userId;
      const prev = active.get(userId);
      if (prev && prev !== socket) {
        try {
          prev.send(
            JSON.stringify({
              type: "session.disconnected",
              reason: "new_session",
            }),
          );
        } catch {
          /* ignore */
        }
        prev.close();
      }
      active.set(userId, socket);

      await markWsOnline(redis, userId, config.SESSION_TTL_SEC);

      let connectionLogId: string | null = null;
      const conn = await prisma.connectionLog.create({
        data: {
          userId,
          sessionId: sid ?? "unknown",
          websocketStatus: "open",
        },
      });
      connectionLogId = conn.id;

      let dockerStream: NodeJS.ReadWriteStream | null = null;
      let mirror = "";
      let lastActivity = Date.now();
      const accessTouch = { lastTouchMs: 0 };
      let idleTimer: ReturnType<typeof setInterval> | null = null;

      const resetIdle = () => {
        lastActivity = Date.now();
        void touchContainerAssignmentLastAccessIfDue(prisma, userId, accessTouch);
      };

      const setupIdle = () => {
        if (idleTimer) clearInterval(idleTimer);
        idleTimer = setInterval(() => {
          const idleSec = (Date.now() - lastActivity) / 1000;
          if (idleSec >= config.IDLE_DISCONNECT_SEC) {
            try {
              socket.send(
                JSON.stringify({
                  type: "session.disconnected",
                  reason: "idle_timeout",
                }),
              );
            } catch {
              /* ignore */
            }
            socket.close();
          } else if (idleSec >= config.IDLE_WARN_SEC) {
            try {
              socket.send(
                JSON.stringify({
                  type: "session.idle_warning",
                  message: "長時間操作がありません",
                  timeout_sec: Math.ceil(config.IDLE_DISCONNECT_SEC - idleSec),
                }),
              );
            } catch {
              /* ignore */
            }
          }
        }, 15_000);
      };
      setupIdle();

      try {
        const { containerId: cid } = await ensureLearnerContainer(
          prisma,
          config,
          userId,
          null,
        );
        const container = getDocker(config).getContainer(cid);
        const stream = await container.attach({
          stream: true,
          stdin: true,
          stdout: true,
          stderr: false,
          hijack: true,
          // Docker API では tty が必要（型定義に無い場合あり）
          tty: true,
        } as never);
        dockerStream = stream;

        let attachNoisePending = Buffer.alloc(0);
        let attachNoiseStripping = true;

        // 先に data を購読してから resize する。リスナー登録前に流れたプロンプトを取りこぼさない
        stream.on("data", (chunk: Buffer) => {
          resetIdle();
          let outChunks: Buffer[];
          if (attachNoiseStripping) {
            const r = consumeLeadingDockerodeAttachNoise(attachNoisePending, chunk);
            attachNoisePending = Buffer.from(r.pending);
            if (attachNoisePending.length > 0) {
              return;
            }
            attachNoiseStripping = false;
            outChunks = r.emit;
          } else {
            outChunks = [chunk];
          }
          for (const buf of outChunks) {
            if (buf.length === 0) continue;
            socket.send(
              JSON.stringify({
                type: "terminal.output",
                data: buf.toString("base64"),
              }),
            );
          }
        });

        // TTY サイズ確定でシェルがプロンプトを再描画（取りこぼし対策で続けて 2 回）
        const kickResize = async () => {
          try {
            await container.resize({ h: 24, w: 80 });
          } catch {
            /* ignore */
          }
        };
        await kickResize();
        setTimeout(() => {
          void kickResize();
        }, 50);
        stream.on("error", () => {
          socket.send(
            JSON.stringify({
              type: "error",
              code: "DOCKER_STREAM",
              message: "シェル接続でエラーが発生しました",
            }),
          );
        });
        stream.on("end", () => {
          socket.send(JSON.stringify({ type: "terminal.exit", code: 0 }));
        });

        socket.on("message", (raw: Buffer) => {
          void (async () => {
            resetIdle();
            let msg: { type?: string; data?: string; cols?: number; rows?: number };
            try {
              msg = JSON.parse(raw.toString("utf8"));
            } catch {
              return;
            }
            if (msg.type === "ping") {
              socket.send(JSON.stringify({ type: "pong" }));
              return;
            }
            if (msg.type === "terminal.resize" && msg.cols && msg.rows) {
              try {
                await container.resize({ h: msg.rows, w: msg.cols });
              } catch {
                /* ignore */
              }
              return;
            }
            if (msg.type !== "terminal.input" || !msg.data || !dockerStream) return;

            const chunk = Buffer.from(msg.data, "base64");
            dockerStream.write(chunk);
            mirror += chunk.toString("utf8");

            let idx: number;
            while ((idx = mirror.indexOf("\n")) >= 0) {
              const line = mirror.slice(0, idx + 1);
              mirror = mirror.slice(idx + 1);
              const lineText = line.replace(/\r?\n$/, "");
              const { blocked } = getTerminalLineBlockInfo(lineText);
              await prisma.commandHistory.create({
                data: {
                  userId,
                  connectionId: connectionLogId,
                  commandText: lineText,
                  resultStatus: blocked ? "blocked" : "ok",
                },
              });
              if (blocked) {
                const warn =
                  "\r\n[system] このコマンドはポリシー上ブロックされています（実行済みの場合は環境をリセットしてください）\r\n";
                socket.send(
                  JSON.stringify({
                    type: "terminal.output",
                    data: Buffer.from(warn, "utf8").toString("base64"),
                  }),
                );
              }
            }
          })();
        });
      } catch (e) {
        socket.send(
          JSON.stringify({
            type: "error",
            code: "ENV_ERROR",
            message:
              e instanceof Error ? e.message : "環境の準備に失敗しました",
          }),
        );
        socket.close();
        return;
      }

      const cleanup = async () => {
        if (idleTimer) clearInterval(idleTimer);
        if (active.get(userId) === socket) active.delete(userId);
        await markWsOffline(redis, userId);
        if (connectionLogId) {
          await prisma.connectionLog.update({
            where: { id: connectionLogId },
            data: { disconnectedAt: new Date(), websocketStatus: "closed" },
          });
        }
        try {
          dockerStream?.end();
        } catch {
          /* ignore */
        }
      };

      socket.on("close", () => {
        void cleanup();
      });
    },
  );
}
