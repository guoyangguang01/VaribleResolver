import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertInsideRoot } from "./projectPaths.js";
import { runProgram } from "./processRunner.js";
import { createProjectRunWorkspace } from "./runWorkspace.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const PROJECT_SCHEMA_VERSION = 4;

let mainWindow = null;
let hasUnsavedChanges = false;
let forceClose = false;
let closePromptOpen = false;

function windowBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? "#14171c" : "#f3f5f7";
}

async function readTextFile(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("文件路径不能为空。");
  }
  const absolutePath = path.resolve(filePath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) throw new Error(`不是文件：${absolutePath}`);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`文件超过 32 MB：${absolutePath}`);
  }
  const buffer = await fs.readFile(absolutePath);
  if (buffer.includes(0)) {
    throw new Error(`检测到二进制内容：${absolutePath}`);
  }
  return {
    path: absolutePath,
    name: path.basename(absolutePath),
    content: buffer.toString("utf8"),
    size: stat.size,
    modifiedAt: stat.mtimeMs,
  };
}

function createWindow() {
  hasUnsavedChanges = false;
  forceClose = false;
  closePromptOpen = false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: windowBackgroundColor(),
    title: "Program Studio",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(
      path.join(currentDirectory, "..", "dist", "index.html"),
    );
  }

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on("close", async (event) => {
    if (!hasUnsavedChanges || forceClose) return;
    event.preventDefault();
    if (closePromptOpen) return;
    closePromptOpen = true;
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "未保存的更改",
      message: "当前工程包含未保存的更改。",
      detail: "关闭客户端将丢失这些更改。",
      buttons: ["返回应用", "放弃更改并退出"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    closePromptOpen = false;
    if (result.response === 1 && mainWindow && !mainWindow.isDestroyed()) {
      forceClose = true;
      mainWindow.close();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("client:set-dirty", (_event, dirty) => {
  hasUnsavedChanges = Boolean(dirty);
});

ipcMain.on("client:set-theme", (_event, preference) => {
  if (
    preference !== "system" &&
    preference !== "light" &&
    preference !== "dark"
  ) {
    return;
  }
  nativeTheme.themeSource = preference;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(windowBackgroundColor());
  }
});

ipcMain.handle("client:select-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择程序输入文件",
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled) return [];
  return Promise.all(result.filePaths.map(readTextFile));
});

ipcMain.handle("client:read-files", async (_event, filePaths) => {
  if (!Array.isArray(filePaths)) throw new Error("文件路径列表无效。");
  return Promise.all(filePaths.map(readTextFile));
});

ipcMain.handle("client:write-files", async (_event, files) => {
  if (!Array.isArray(files)) throw new Error("文件列表无效。");
  const written = [];
  for (const file of files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.content !== "string"
    ) {
      throw new Error("文件写入参数无效。");
    }
    const absolutePath = path.resolve(file.path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.content, "utf8");
    written.push(absolutePath);
  }
  return written;
});

ipcMain.handle("client:update-files", async (_event, files) => {
  if (!Array.isArray(files)) throw new Error("文件列表无效。");
  const targets = [];
  for (const file of files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.content !== "string"
    ) {
      throw new Error("原文件更新参数无效。");
    }
    if (!path.isAbsolute(file.path)) {
      throw new Error(`原文件必须使用绝对路径：${file.path}`);
    }
    const absolutePath = path.resolve(file.path);
    if (Buffer.byteLength(file.content, "utf8") > MAX_FILE_BYTES) {
      throw new Error(`文件超过 32 MB：${absolutePath}`);
    }
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      throw new Error(`原文件不存在：${absolutePath}`);
    }
    if (!stat.isFile()) throw new Error(`不是文件：${absolutePath}`);
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(`文件超过 32 MB：${absolutePath}`);
    }
    targets.push({
      absolutePath,
      content: file.content,
      original: await fs.readFile(absolutePath),
    });
  }

  const written = [];
  for (const target of targets) {
    const originalText = target.original.toString("utf8");
    const lineEnding = /\r\n|\r|\n/.exec(originalText)?.[0] ?? "\n";
    const normalizedContent = target.content.replace(/\r\n?/g, "\n");
    let content =
      lineEnding === "\n"
        ? normalizedContent
        : normalizedContent.replace(/\n/g, lineEnding);
    const hasUtf8Bom =
      target.original[0] === 0xef &&
      target.original[1] === 0xbb &&
      target.original[2] === 0xbf;
    if (hasUtf8Bom && !content.startsWith("\ufeff")) {
      content = `\ufeff${content}`;
    }
    await fs.writeFile(target.absolutePath, content, "utf8");
    written.push(target.absolutePath);
  }
  return written;
});

ipcMain.handle("client:save-project", async (_event, payload, options) => {
  if (
    !payload ||
    typeof payload.folderName !== "string" ||
    !payload.manifest ||
    !payload.launch ||
    !payload.parameters ||
    !payload.outputs ||
    !Array.isArray(payload.files)
  ) {
    throw new Error("工程目录数据无效。");
  }
  const safeFolderName = payload.folderName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!safeFolderName) throw new Error("工程目录名称无效。");

  const mode = options?.mode === "save" ? "save" : "saveAs";
  let projectDirectory;
  if (mode === "save") {
    if (typeof options.path !== "string" || !options.path.trim()) {
      throw new Error("原位保存需要有效的工程目录路径。");
    }
    projectDirectory = path.resolve(options.path);
    let existingManifest;
    try {
      existingManifest = JSON.parse(
        await fs.readFile(path.join(projectDirectory, "project.json"), "utf8"),
      );
    } catch {
      throw new Error(`不是有效的 Program Studio 工程目录：${projectDirectory}`);
    }
    if (
      existingManifest?.schema !== "program-studio-folder-project" ||
      existingManifest?.schemaVersion !== PROJECT_SCHEMA_VERSION
    ) {
      throw new Error(`工程版本不受支持：${projectDirectory}`);
    }
  } else {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择工程保存位置",
      buttonLabel: "保存到此目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;

    const parentDirectory = path.resolve(result.filePaths[0]);
    projectDirectory = path.join(parentDirectory, safeFolderName);
    try {
      await fs.access(projectDirectory);
      throw new Error(`工程目录已存在：${projectDirectory}`);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        // Directory does not exist, which is the expected state.
      } else {
        throw error;
      }
    }
  }

  await fs.mkdir(path.join(projectDirectory, "files"), { recursive: true });
  await fs.writeFile(
    path.join(projectDirectory, "project.json"),
    JSON.stringify(payload.manifest, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(projectDirectory, "launch.json"),
    JSON.stringify(payload.launch, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(projectDirectory, "parameters.json"),
    JSON.stringify(payload.parameters, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(projectDirectory, "outputs.json"),
    JSON.stringify(payload.outputs, null, 2),
    "utf8",
  );
  for (const file of payload.files) {
    if (
      !file ||
      typeof file.relativePath !== "string" ||
      typeof file.content !== "string"
    ) {
      throw new Error("工程封装文件参数无效。");
    }
    const targetPath = path.resolve(projectDirectory, file.relativePath);
    assertInsideRoot(
      targetPath,
      projectDirectory,
      `工程文件路径越界：${file.relativePath}`,
    );
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, file.content, "utf8");
  }
  return {
    path: projectDirectory,
    name: payload.manifest.name,
  };
});

async function readProjectDirectory(projectDirectory) {
  const manifestPath = path.join(projectDirectory, "project.json");
  const launchPath = path.join(projectDirectory, "launch.json");
  const parametersPath = path.join(projectDirectory, "parameters.json");
  const outputsPath = path.join(projectDirectory, "outputs.json");
  const [manifestSource, launchSource, parametersSource, outputsSource] =
    await Promise.all([
      fs.readFile(manifestPath, "utf8"),
      fs.readFile(launchPath, "utf8"),
      fs.readFile(parametersPath, "utf8"),
      fs.readFile(outputsPath, "utf8"),
    ]);
  const manifest = JSON.parse(manifestSource);
  if (!Array.isArray(manifest.files)) {
    throw new Error("project.json 缺少 files 文件清单。");
  }
  const files = await Promise.all(
    manifest.files.map(async (entry) => {
      if (!entry || typeof entry.relativePath !== "string") {
        throw new Error("工程文件清单条目无效。");
      }
      const filePath = path.resolve(projectDirectory, entry.relativePath);
      assertInsideRoot(
        filePath,
        projectDirectory,
        `工程文件路径越界：${entry.relativePath}`,
      );
      return {
        relativePath: entry.relativePath,
        content: (await fs.readFile(filePath)).toString("utf8"),
      };
    }),
  );
  return {
    folderPath: projectDirectory,
    manifest,
    launch: JSON.parse(launchSource),
    parameters: JSON.parse(parametersSource),
    outputs: JSON.parse(outputsSource),
    files,
  };
}

function defaultProjectDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "default-project")
    : path.resolve(currentDirectory, "..", "default-project");
}

ipcMain.handle("client:open-project", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "打开 Program Studio 工程",
    buttonLabel: "打开工程",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return readProjectDirectory(path.resolve(result.filePaths[0]));
});

ipcMain.handle("client:open-default-project", async () => {
  return readProjectDirectory(defaultProjectDirectory());
});

ipcMain.handle("client:create-run-workspace", async (_event, projectPath) => {
  if (typeof projectPath !== "string" || !projectPath.trim()) {
    throw new Error("工程目录不能为空。");
  }
  return createProjectRunWorkspace(path.resolve(projectPath));
});

ipcMain.handle("client:run-program", async (_event, request) => {
  if (!request || typeof request.program !== "string" || !request.program.trim()) {
    throw new Error("程序路径不能为空。");
  }
  const args = Array.isArray(request.args)
    ? request.args.map((argument) => String(argument))
    : [];
  const cwd =
    typeof request.cwd === "string" && request.cwd.trim()
      ? path.resolve(request.cwd)
      : undefined;
  const mode =
    request.mode === "shell" ? "shell" : "direct";
  const environment =
    request.environment &&
    typeof request.environment === "object" &&
    !Array.isArray(request.environment)
      ? Object.fromEntries(
          Object.entries(request.environment).map(([key, value]) => [
            key,
            String(value),
          ]),
        )
      : {};
  return runProgram({
    mode,
    program: request.program.trim(),
    args,
    cwd,
    environment,
  });
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
