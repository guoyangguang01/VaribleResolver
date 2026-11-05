import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("desktop client exposes path file IO and local program execution", async () => {
  const root = process.cwd();
  const tempFile = path.join(
    os.tmpdir(),
    `program-studio-${Date.now()}.txt`,
  );
  const app = await electron.launch({
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: "http://127.0.0.1:4173",
    },
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByText("桌面客户端 · 本机路径读写")).toBeVisible();
    expect(
      await page.evaluate(() => Boolean(window.programStudio?.isDesktop)),
    ).toBe(true);

    const roundTrip = await page.evaluate(async (filePath) => {
      const api = window.programStudio;
      if (!api) throw new Error("Desktop API unavailable");
      await api.writeFiles([
        { path: filePath, content: "VALUE: 42\nSTATUS: OK\n" },
      ]);
      return api.readFiles([filePath]);
    }, tempFile);
    expect(roundTrip[0]?.content).toContain("STATUS: OK");

    const run = await page.evaluate(
      ({ executable }) =>
        window.programStudio?.runProgram({
          program: executable,
          args: ["-e", "console.log('desktop-run-ok')"],
          timeoutMs: 10_000,
        }),
      { executable: process.execPath },
    );
    expect(run?.status).toBe("completed");
    expect(run?.stdout).toContain("desktop-run-ok");
  } finally {
    await app.close();
    await fs.rm(tempFile, { force: true });
  }
});
