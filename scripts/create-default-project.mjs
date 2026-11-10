import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const projectDirectory = path.resolve(root, "default-project");

if (path.dirname(projectDirectory) !== root) {
  throw new Error(`默认工程目录超出项目根目录：${projectDirectory}`);
}

const server = await createServer({
  root,
  configFile: path.join(root, "vite.config.ts"),
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const { buildFa1Example } = await server.ssrLoadModule(
    "/src/lib/fa1Example.ts",
  );
  const { serializeProjectFolder } = await server.ssrLoadModule(
    "/src/lib/projectFolder.ts",
  );
  const example = buildFa1Example(path.join(root, "testData"));
  const payload = serializeProjectFolder({
    name: example.name,
    program: example.program,
    arguments: example.arguments,
    workingDirectory: example.workingDirectory,
    launchMode: example.launchMode,
    files: example.files,
    bindings: example.bindings,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  payload.manifest.updatedAt = payload.manifest.createdAt;
  for (const file of payload.manifest.files) {
    file.path = file.relativePath;
  }
  await fs.rm(projectDirectory, { recursive: true, force: true });
  await fs.mkdir(projectDirectory, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(projectDirectory, "project.json"),
      `${JSON.stringify(payload.manifest, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(projectDirectory, "launch.json"),
      `${JSON.stringify(payload.launch, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(projectDirectory, "parameters.json"),
      `${JSON.stringify(payload.parameters, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(projectDirectory, "outputs.json"),
      `${JSON.stringify(payload.outputs, null, 2)}\n`,
      "utf8",
    ),
  ]);
  for (const file of payload.files) {
    const targetPath = path.resolve(projectDirectory, file.relativePath);
    if (
      targetPath !== projectDirectory &&
      !targetPath.startsWith(`${projectDirectory}${path.sep}`)
    ) {
      throw new Error(`默认工程文件超出目录：${file.relativePath}`);
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, file.content, "utf8");
  }

  console.log(`Created ${projectDirectory}`);
} finally {
  await server.close();
}
