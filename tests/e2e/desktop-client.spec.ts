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
  const projectDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "program-studio-project-"),
  );
  await fs.writeFile(
    path.join(projectDirectory, "project.json"),
    JSON.stringify({
      schema: "program-studio-folder-project",
      schemaVersion: 2,
    }),
    "utf8",
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
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector("#program-runner", { state: "attached" });
    await expect(page.locator(".status-mode")).toContainText("本机模式");
    expect(
      await page.evaluate(() => Boolean(window.programStudio?.isDesktop)),
    ).toBe(true);
    expect(
      await page.evaluate(() => ({
        setDirty: typeof window.programStudio?.setDirty,
        setTheme: typeof window.programStudio?.setTheme,
        saveProject: typeof window.programStudio?.saveProject,
      })),
    ).toEqual({
      setDirty: "function",
      setTheme: "function",
      saveProject: "function",
    });

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

    const saved = await page.evaluate(
      async ({ directory }) => {
        const api = window.programStudio;
        if (!api) throw new Error("Desktop API unavailable");
        return api.saveProject(
          {
            folderName: "Desktop Save",
            manifest: {
              schema: "program-studio-folder-project",
              schemaVersion: 2,
              name: "Desktop Save",
              createdAt: "2026-11-05T00:00:00.000Z",
              updatedAt: "2026-11-05T00:00:00.000Z",
              launchFile: "launch.json",
              parameterFile: "parameters.json",
              files: [
                {
                  path: "D:\\cases\\data.txt",
                  relativePath: "files/001-data.txt",
                },
              ],
            },
            launch: {
              program: "runner.exe",
              arguments: "--input data.txt",
              workingDirectory: "D:\\cases",
            },
            parameters: { bindings: [] },
            files: [
              {
                relativePath: "files/001-data.txt",
                content: "VALUE: 42\n",
              },
            ],
          },
          { mode: "save", path: directory },
        );
      },
      { directory: projectDirectory },
    );
    expect(saved?.path).toBe(projectDirectory);
    expect(
      await fs.readFile(
        path.join(projectDirectory, "files", "001-data.txt"),
        "utf8",
      ),
    ).toContain("VALUE: 42");
  } finally {
    await app.close();
    await fs.rm(tempFile, { force: true });
    await fs.rm(projectDirectory, { recursive: true, force: true });
  }
});
