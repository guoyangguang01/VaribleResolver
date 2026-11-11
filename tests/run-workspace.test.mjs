import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProjectRunWorkspace } from "../electron/runWorkspace.js";
import { expandEnvironmentVariables } from "../electron/processRunner.js";

test("expands environment variables in runtime commands", () => {
  assert.equal(
    expandEnvironmentVariables(
      "%AWP_ROOT195%/Framework/bin/Win64/RunWB2.exe",
      { AWP_ROOT195: "D:\\ANSYS" },
    ),
    "D:\\ANSYS/Framework/bin/Win64/RunWB2.exe",
  );
  assert.throws(
    () => expandEnvironmentVariables("%MISSING_ROOT%/runner.exe", {}),
    /环境变量未设置：MISSING_ROOT/,
  );
});

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("creates an isolated run workspace without stale reference outputs", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "program-studio-run-workspace-"),
  );
  const project = path.join(root, "project");
  try {
    await fs.mkdir(path.join(project, "files"), { recursive: true });
    await fs.writeFile(
      path.join(project, "files", "input.ccl"),
      "temperature = 20\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(project, "files", "report.txt"),
      "maximum = 10\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(project, "files", "macro.txt"),
      "#UCW_PRJ_DIR#\\files\\report.txt\n",
      "utf8",
    );
    await writeJson(path.join(project, "project.json"), {
      schema: "program-studio-folder-project",
      schemaVersion: 5,
      modules: [],
      files: [
        {
          path: "files/input.ccl",
          roles: ["input"],
        },
        {
          path: "files/report.txt",
          roles: ["output-reference"],
        },
      ],
    });
    await writeJson(path.join(project, "outputs.json"), {
      outputs: [
        {
          name: "report",
          referenceFile: "files/report.txt",
          runtimePath: "files/report.txt",
          required: true,
          seed: "never",
          discovery: { type: "path" },
        },
      ],
    });

    const run = await createProjectRunWorkspace(project);
    assert.equal(run.path, path.join(project, "run"));
    assert.equal(
      await fs.readFile(
        path.join(run.path, "files", "macro.txt"),
        "utf8",
      ),
      `${run.path}\\files\\report.txt\n`,
    );
    assert.equal(
      await fs.readFile(
        path.join(run.path, "files", "input.ccl"),
        "utf8",
      ),
      "temperature = 20\n",
    );
    await assert.rejects(
      () => fs.access(path.join(run.path, "files", "report.txt")),
      /ENOENT/,
    );
    assert.equal(
      await fs.readFile(
        path.join(project, "files", "report.txt"),
        "utf8",
      ),
      "maximum = 10\n",
    );
    await fs.writeFile(
      path.join(run.path, "files", "stale.txt"),
      "stale\n",
      "utf8",
    );
    const rerun = await createProjectRunWorkspace(project);
    assert.equal(rerun.path, run.path);
    await assert.rejects(
      () => fs.access(path.join(rerun.path, "files", "stale.txt")),
      /ENOENT/,
    );
    await assert.rejects(() => fs.access(path.join(project, "runs")), /ENOENT/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("keeps a seeded output when the output contract requests a reference copy", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "program-studio-seeded-output-"),
  );
  const project = path.join(root, "project");
  try {
    await fs.mkdir(path.join(project, "files"), { recursive: true });
    await fs.writeFile(
      path.join(project, "files", "report.txt"),
      "maximum = 10\n",
      "utf8",
    );
    await writeJson(path.join(project, "project.json"), {
      schema: "program-studio-folder-project",
      schemaVersion: 5,
      modules: [],
      files: [
        {
          path: "files/report.txt",
          roles: ["output-reference"],
        },
      ],
    });
    await writeJson(path.join(project, "outputs.json"), {
      outputs: [
        {
          name: "report",
          referenceFile: "files/report.txt",
          runtimePath: "files/report.txt",
          required: true,
          seed: "copy-reference",
          discovery: { type: "path" },
        },
      ],
    });

    const run = await createProjectRunWorkspace(project);
    assert.equal(
      await fs.readFile(
        path.join(run.path, "files", "report.txt"),
        "utf8",
      ),
      "maximum = 10\n",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
