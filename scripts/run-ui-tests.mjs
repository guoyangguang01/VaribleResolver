import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const playwrightCli = path.join(
  root,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);

const server = await createServer({
  root,
  configFile: path.join(root, "vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});

await server.listen();
server.printUrls();

try {
  const testProcess = spawn(
    process.execPath,
    [playwrightCli, "test", ...process.argv.slice(2)],
    {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    },
  );
  const exitCode = await new Promise((resolve, reject) => {
    testProcess.once("error", reject);
    testProcess.once("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
} finally {
  await server.close();
}
