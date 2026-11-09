import fs from "node:fs/promises";
import path from "node:path";
import { assertInsideRoot } from "./projectPaths.js";

function resolveInside(root, relativePath) {
  const target = path.resolve(root, relativePath);
  return assertInsideRoot(
    target,
    root,
    `运行路径越界：${relativePath}`,
  );
}

function runIdCandidate() {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
  return `run-${timestamp}`;
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function reserveRunDirectory(projectDirectory) {
  const runsRoot = path.join(projectDirectory, "runs");
  await fs.mkdir(runsRoot, { recursive: true });
  const base = runIdCandidate();
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const runId = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const runDirectory = path.join(runsRoot, runId);
    try {
      await fs.mkdir(runDirectory);
      return { runId, runDirectory };
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }
  throw new Error("无法创建唯一的运行工作区。");
}

function fileRolesByPath(manifest) {
  const roles = new Map();
  if (!manifest || !Array.isArray(manifest.files)) return roles;
  for (const file of manifest.files) {
    if (
      file &&
      typeof file.relativePath === "string" &&
      Array.isArray(file.roles)
    ) {
      roles.set(path.normalize(file.relativePath), new Set(file.roles));
    }
  }
  return roles;
}

async function applyOutputSeedPolicy({
  runDirectory,
  outputs,
  manifest,
}) {
  if (!outputs || !Array.isArray(outputs.outputs)) return;
  const rolesByPath = fileRolesByPath(manifest);
  for (const output of outputs.outputs) {
    if (
      !output ||
      output.seed !== "never" ||
      typeof output.runtimePath !== "string"
    ) {
      continue;
    }
    const roles = rolesByPath.get(path.normalize(output.runtimePath));
    if (
      roles &&
      (roles.has("input") ||
        roles.has("support") ||
        roles.has("program-entry"))
    ) {
      continue;
    }
    const target = resolveInside(runDirectory, output.runtimePath);
    await fs.rm(target, { force: true });
  }
}

export async function createProjectRunWorkspace(
  projectDirectory,
  options = {},
) {
  const root = path.resolve(projectDirectory);
  await fs.access(path.join(root, "project.json"));
  const runsRoot = path.join(root, "runs");
  const { runId, runDirectory } =
    options.runId === undefined
      ? await reserveRunDirectory(root)
      : (() => {
          const requested = String(options.runId).trim();
          if (!requested) throw new Error("运行 ID 不能为空。");
          return {
            runId: requested,
            runDirectory: path.join(runsRoot, requested),
          };
        })();
  await fs.mkdir(runDirectory, { recursive: true });
  const entries = await fs.readdir(runDirectory);
  if (entries.length > 0) {
    throw new Error(`运行工作区已存在：${runDirectory}`);
  }

  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.name === "runs") continue;
    await fs.cp(
      path.join(root, entry.name),
      path.join(runDirectory, entry.name),
      { recursive: entry.isDirectory() },
    );
  }

  const [manifest, outputs] = await Promise.all([
    readJsonIfPresent(path.join(root, "project.json")),
    readJsonIfPresent(path.join(root, "outputs.json")),
  ]);
  await applyOutputSeedPolicy({
    runDirectory,
    outputs,
    manifest,
  });
  return { runId, path: runDirectory };
}
