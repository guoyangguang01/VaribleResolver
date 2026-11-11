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

function fileRolesByPath(manifest) {
  const roles = new Map();
  if (!manifest || !Array.isArray(manifest.files)) return roles;
  for (const file of manifest.files) {
    if (
      file &&
      typeof file.path === "string" &&
      Array.isArray(file.roles)
    ) {
      roles.set(path.normalize(file.path), new Set(file.roles));
    }
  }
  return roles;
}

async function expandProjectDirectoryMacros(directory, projectDirectory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  const nativeProjectPath = projectDirectory.includes("\\")
    ? projectDirectory.replace(/\//g, "\\")
    : projectDirectory.replace(/\\/g, "/");
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await expandProjectDirectoryMacros(target, projectDirectory);
      continue;
    }
    if (!entry.isFile()) continue;
    const content = await fs.readFile(target);
    if (content.includes(0)) continue;
    const text = content.toString("utf8");
    const expanded = text.replaceAll(
      "#UCW_PRJ_DIR#",
      nativeProjectPath,
    );
    if (expanded !== text) {
      await fs.writeFile(target, expanded, "utf8");
    }
  }
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
) {
  const root = path.resolve(projectDirectory);
  await fs.access(path.join(root, "project.json"));
  const runDirectory = path.join(root, "run");
  await fs.rm(runDirectory, { recursive: true, force: true });
  await fs.rm(path.join(root, "runs"), { recursive: true, force: true });
  await fs.mkdir(runDirectory, { recursive: true });

  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.name === "run" || entry.name === "runs") continue;
    await fs.cp(
      path.join(root, entry.name),
      path.join(runDirectory, entry.name),
      { recursive: entry.isDirectory() },
    );
  }
  await expandProjectDirectoryMacros(
    path.join(runDirectory, "files"),
    runDirectory,
  );

  const [manifest, outputs] = await Promise.all([
    readJsonIfPresent(path.join(root, "project.json")),
    readJsonIfPresent(path.join(root, "outputs.json")),
  ]);
  await applyOutputSeedPolicy({
    runDirectory,
    outputs,
    manifest,
  });
  return { path: runDirectory };
}
