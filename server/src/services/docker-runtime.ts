import Docker from "dockerode";
import type { AppConfig } from "../config.js";

function dockerHttpStatus(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "statusCode" in e) {
    const c = (e as { statusCode?: number }).statusCode;
    return typeof c === "number" ? c : undefined;
  }
  return undefined;
}

let docker: Docker | null = null;

export function getDocker(config: AppConfig): Docker {
  if (!docker) {
    docker = new Docker({ socketPath: config.DOCKER_SOCKET_PATH });
  }
  return docker;
}

export type CreateLearnerContainerParams = {
  name: string;
  image: string;
};

export async function removeContainerByName(config: AppConfig, name: string): Promise<void> {
  const d = getDocker(config);
  try {
    const c = d.getContainer(name);
    const info = await c.inspect();
    await stopAndRemoveContainer(config, info.Id);
  } catch (e) {
    const st = dockerHttpStatus(e);
    if (st === 404) return;
    console.warn(
      `[docker] removeContainerByName: ${name} (status ${st ?? "unknown"})`,
      e,
    );
  }
}

const CREATE_CONFLICT_RETRIES = 2;

export async function createLearnerContainer(
  config: AppConfig,
  params: CreateLearnerContainerParams,
): Promise<{ id: string }> {
  const d = getDocker(config);
  const createOpts = {
    Image: params.image,
    name: params.name,
    Tty: true,
    OpenStdin: true,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: false,
    // ログイン対話シェル（プロンプト・プロファイル読込）。TTY attach 前に出た出力は捨てられるため WS 側で resize する
    Cmd: ["/bin/bash", "-il"],
    Env: ["TERM=xterm"],
    User: "1000:1000",
    HostConfig: {
      NetworkMode:
        config.LEARNER_CONTAINER_NETWORK_MODE === "none" ? "none" : "bridge",
      Memory: 128 * 1024 * 1024,
      NanoCpus: 500_000_000,
      PidsLimit: 256,
      // CapDrop ALL / no-new-privileges は sudo の setuid・gid 切替と両立しない。
      // 研修用は NetworkMode=none・非特権ユーザー・メモリ上限で隔離する。
    },
    Labels: {
      "linuxtrainer.role": "learner",
    },
  };

  for (let attempt = 0; attempt <= CREATE_CONFLICT_RETRIES; attempt++) {
    await removeContainerByName(config, params.name);
    try {
      const container = await d.createContainer(createOpts);
      await container.start();
      const info = await container.inspect();
      return { id: info.Id };
    } catch (e) {
      if (dockerHttpStatus(e) === 409 && attempt < CREATE_CONFLICT_RETRIES) {
        console.warn(
          `[docker] createContainer conflict for ${params.name}, retry ${attempt + 1}`,
        );
        continue;
      }
      throw e;
    }
  }
  throw new Error("createLearnerContainer: exhausted retries");
}

export async function stopAndRemoveContainer(
  config: AppConfig,
  containerId: string,
): Promise<void> {
  const d = getDocker(config);
  const c = d.getContainer(containerId);
  try {
    await c.stop({ t: 5 });
  } catch {
    // ignore
  }
  try {
    await c.remove({ force: true });
  } catch {
    // ignore
  }
}
