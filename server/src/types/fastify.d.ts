import type { SessionPayload } from "../lib/sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionPayload;
  }
}
