import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const app = await buildApp(config);

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`listening on ${config.HOST}:${config.PORT}`);
