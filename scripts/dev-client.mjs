import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import electronPath from "electron";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  configFile: path.join(root, "vite.config.ts"),
});

await server.listen();
const address = server.httpServer?.address();
const port = typeof address === "object" && address ? address.port : 5174;
const url = `http://127.0.0.1:${port}`;
console.log(`Program Studio desktop: ${url}`);

const client = spawn(electronPath, ["."], {
  cwd: root,
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: url,
  },
  stdio: "inherit",
});

client.once("exit", async (code) => {
  await server.close();
  process.exitCode = code ?? 0;
});

process.on("SIGINT", () => client.kill());
process.on("SIGTERM", () => client.kill());
