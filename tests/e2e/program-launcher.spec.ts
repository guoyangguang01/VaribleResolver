import { expect, test, type Page } from "./electron-fixture";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function writeJson(filePath: string, value: unknown) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function selectInRunner(page: Page, text: string) {
  const host = page.locator(
    "#program-runner .runner-editor-shell .codemirror-host",
  );
  const selected = await host.evaluate((element, input) => {
    const view = (element as HTMLElement & { __cmView?: any }).__cmView;
    if (!view) throw new Error("CodeMirror view not found");
    const source = view.state.doc.toString();
    const start = source.indexOf(input.text);
    if (start < 0) throw new Error(`Text not found: ${input.text}`);
    view.focus();
    view.dispatch({
      selection: { anchor: start, head: start + input.text.length },
      scrollIntoView: true,
    });
    return source.slice(start, start + input.text.length);
  }, { text });

  expect(selected).toBe(text);
  await expect(
    page.locator(".runner-selection-bar strong"),
  ).toContainText(text);
}

async function openEditorContextMenu(page: Page) {
  const host = page.locator(
    "#program-runner .runner-editor-shell .codemirror-host",
  );
  await host.evaluate((element) => {
    const view = (element as HTMLElement & { __cmView?: any }).__cmView;
    if (!view) throw new Error("CodeMirror view not found");
    const position = view.state.selection.main.from;
    const coordinates = view.coordsAtPos(position) ?? {
      left: 160,
      top: 160,
    };
    view.contentDOM.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: coordinates.left + 2,
        clientY: coordinates.top + 8,
      }),
    );
  });
  await expect(
    page.getByRole("menu", { name: "编辑器参数菜单" }),
  ).toBeVisible();
}

async function addParameterFromContextMenu(
  page: Page,
  direction: "输入" | "输出",
) {
  await openEditorContextMenu(page);
  await page
    .getByRole("menu", { name: "编辑器参数菜单" })
    .getByRole("menuitem", { name: `添加为${direction}参数` })
    .click();
}

test.describe("default fa1 project", () => {
  test.use({ startWithDefaultProject: true });

  test("opens the fa1 test case as an existing project on startup", async ({
    page,
  }) => {
    const runner = page.locator("#program-runner");

    await expect(runner.getByLabel("工程名称")).toHaveValue(
      "fa1 标准执行示例",
    );
    await expect(runner.getByLabel("有未保存的更改")).toHaveCount(0);
    await expect(runner.locator(".runner-project-path")).toContainText(
      path.join(process.cwd(), "default-project"),
    );
    await expect(runner.locator(".runner-binding")).toHaveCount(152);
    await expect(runner.locator(".runner-notice")).toContainText(
      "已打开默认测试工程",
    );

    await runner.getByRole("tab", { name: "资源" }).click();
    await expect(runner.locator(".runner-file-item")).toHaveCount(7);
  });
});

test("creates input and output bindings from the editor context menu", async ({
  page,
}) => {
  const runner = page.locator("#program-runner");
  await runner.scrollIntoViewIfNeeded();

  await runner.locator("input.file-input").setInputFiles({
    name: "result.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("INPUT: initial\nRESULT: 12.5\nSTATUS: OK\n"),
  });

  const fileButton = runner
    .locator(".runner-file-select")
    .filter({ hasText: "result.txt" });
  await expect(fileButton).toBeVisible();
  await expect(runner.getByRole("button", { name: /下载/ })).toHaveCount(0);
  await fileButton.click();
  await expect(
    runner.locator(".runner-editor-heading strong"),
  ).toHaveText("result.txt");

  await selectInRunner(page, "initial");
  await addParameterFromContextMenu(page, "输入");
  const inputValue = runner.getByLabel("当前输入值");
  await expect(inputValue).toHaveValue("initial");
  await inputValue.fill("changed");
  await expect(
    runner.getByRole("button", { name: "写回输入" }),
  ).toHaveCount(0);
  await expect(
    runner.getByRole("button", { name: "提取输出" }),
  ).toHaveCount(0);

  await selectInRunner(page, "12.5");
  await addParameterFromContextMenu(page, "输出");
  await expect(runner.locator(".runner-binding.is-output")).toHaveCount(1);

  await runner
    .locator(".runner-binding.is-input")
    .filter({ hasText: "initial" })
    .click();
  await runner
    .getByRole("button", { name: "将 initial 恢复默认值" })
    .click();
  await expect(inputValue).toHaveValue("initial");
});

test("relocates parameter rows after editing and marks deleted targets invalid", async ({
  page,
}) => {
  const runner = page.locator("#program-runner");
  await runner.locator("input.file-input").setInputFiles({
    name: "relocation.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("HEADER\nVALUE: 42\n"),
  });

  await selectInRunner(page, "42");
  await addParameterFromContextMenu(page, "输入");
  await expect(runner.getByLabel("参数默认值")).toHaveValue("42");
  await expect(runner.getByLabel("当前输入值")).toHaveValue("42");

  const editor = runner.locator(
    ".runner-editor-shell .codemirror-host",
  );
  await editor.evaluate((element) => {
    const view = (element as HTMLElement & { __cmView?: any }).__cmView;
    if (!view) throw new Error("CodeMirror view not found");
    view.dispatch({
      changes: { from: 0, to: 0, insert: "EXTRA\n" },
    });
  });
  await expect(
    runner.locator(
      ".runner-property-locator-summary .runner-binding-meta",
    ),
  ).toContainText("R3");

  await editor.evaluate((element) => {
    const view = (element as HTMLElement & { __cmView?: any }).__cmView;
    if (!view) throw new Error("CodeMirror view not found");
    const source = view.state.doc.toString();
    const from = source.indexOf("42");
    view.dispatch({
      changes: { from, to: from + 2, insert: "43" },
    });
  });
  await expect(runner.getByLabel("参数默认值")).toHaveValue("43");
  await expect(runner.getByLabel("当前输入值")).toHaveValue("42");

  await editor.evaluate((element) => {
    const view = (element as HTMLElement & { __cmView?: any }).__cmView;
    if (!view) throw new Error("CodeMirror view not found");
    const source = view.state.doc.toString();
    const from = source.indexOf("43");
    view.dispatch({
      changes: { from, to: from + 2, insert: "" },
    });
  });
  await expect(
    runner.locator(
      ".runner-property-locator-summary .runner-binding-meta",
    ),
  ).toHaveText("定位失效");
  await expect(
    runner.locator(".runner-binding.has-locator-error"),
  ).toBeVisible();

  await editor.evaluate((element) => {
    const view = (element as HTMLElement & { __cmView?: any }).__cmView;
    if (!view) throw new Error("CodeMirror view not found");
    view.focus();
  });
  await page.keyboard.press("Control+z");
  await expect(
    runner.locator(
      ".runner-property-locator-summary .runner-binding-meta",
    ),
  ).toContainText("R3");
  await expect(
    runner.locator(".runner-binding.has-locator-error"),
  ).toHaveCount(0);
  await expect(runner.getByLabel("参数默认值")).toHaveValue("42");
});

test("builds a quoted launch command from the program profile", async ({
  page,
}) => {
  const runner = page.locator("#program-runner");
  await runner.scrollIntoViewIfNeeded();

  const programField = runner
    .locator(".runner-field")
    .filter({ hasText: "程序路径" })
    .locator("input");
  const argumentsField = runner
    .locator(".runner-field")
    .filter({ hasText: "参数" })
    .locator("textarea");

  await programField.fill("C:\\Tools\\solver.exe");
  await argumentsField.fill('--input "case one.ccl"');

  await expect(runner.locator(".runner-command-area pre")).toHaveText(
    'C:\\Tools\\solver.exe --input "case one.ccl"',
  );
});

test("uses an editable file path as the file identity", async ({ page }) => {
  const runner = page.locator("#program-runner");
  await runner.locator("input.file-input").setInputFiles({
    name: "result.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("RESULT: 42\n"),
  });

  const pathInput = runner.locator(".runner-file-path-field input");
  await pathInput.fill("C:\\cases\\fa1\\result.txt");
  await pathInput.press("Enter");

  await expect(
    runner.locator(".runner-editor-heading strong"),
  ).toHaveText("C:\\cases\\fa1\\result.txt");
  await expect(
    runner.locator(".runner-file-select").filter({
      hasText: "C:\\cases\\fa1\\result.txt",
    }),
  ).toBeVisible();
});

test("loads the fa1 standard example with path files and row-column parameters", async ({
  page,
}) => {
  const runner = page.locator("#program-runner");
  await runner.locator(".runner-load-example").click();

  await runner.getByRole("tab", { name: "资源" }).click();
  await expect(runner.locator(".runner-file-item")).toHaveCount(7);
  await runner
    .locator(".runner-sidebar-tabs")
    .getByRole("tab", { name: /^参数/ })
    .click();
  await expect(runner.locator(".runner-binding")).toHaveCount(152);
  await expect(runner.locator(".runner-binding.is-input")).toHaveCount(138);
  await expect(runner.locator(".runner-binding.is-output")).toHaveCount(14);
  await expect(
    runner.locator(".runner-files .runner-parameter-tree-body"),
  ).toBeVisible();
  await expect(
    runner.locator(".runner-controls .runner-property-form"),
  ).toBeVisible();
  await expect(runner.locator(".runner-parameter-panel")).toHaveCount(0);
  await expect(
    runner
      .locator(".runner-editor-shell .cm-variable-highlight")
      .first(),
  ).toBeVisible();
  await runner.getByRole("tab", { name: "资源" }).click();
  const exampleRoot = path.join(
    process.cwd(),
    "default-project",
    "files",
  );
  await expect(
    runner.locator(".runner-file-select").filter({
      hasText: path.join(exampleRoot, "Stress_Envelope_Summary.txt"),
    }),
  ).toBeVisible();
  await runner
    .locator(".runner-sidebar-tabs")
    .getByRole("tab", { name: /^参数/ })
    .click();
  await runner.getByRole("tab", { name: "启动配置" }).click();
  await expect(runner.getByLabel("启动方式")).toHaveValue("direct");
  await expect(
    runner
      .locator(".runner-field")
      .filter({ hasText: "程序路径" })
      .locator("input"),
  ).toHaveValue(
    "C:\\Program Files\\ANSYS Inc\\v195\\Framework\\bin\\Win64\\RunWB2.exe",
  );
  await expect(
    runner
      .locator(".runner-field")
      .filter({ hasText: "工作目录" })
      .locator("input"),
  ).toHaveValue(exampleRoot);
  await expect(
    runner.locator(".runner-inspector-scroll textarea"),
  ).toHaveValue(`-B -R "${path.join(exampleRoot, "workbench.wbjn")}"`);
  await expect(runner.locator(".runner-notice")).toContainText(
    "7 个路径文件，152 个标准参数",
  );

  await runner
    .getByRole("treeitem", {
      name: "输出参数 CFX速度云图",
    })
    .click();
  await runner.getByRole("tab", { name: "参数属性" }).click();
  const freeLocatorInfo = runner.getByLabel("参数定位信息");
  await expect(freeLocatorInfo).toContainText("分段");
  await expect(freeLocatorInfo).toContainText("分隔符");

  await runner
    .locator(".runner-binding.is-output")
    .filter({ hasText: "全局最大应力" })
    .click();
  await runner.getByRole("tab", { name: "参数属性" }).click();
  const fixedLocatorInfo = runner.getByLabel("参数定位信息");
  await expect(fixedLocatorInfo).toContainText("固定长度");
  await expect(fixedLocatorInfo).toContainText("起始行");
  await expect(fixedLocatorInfo).toContainText("结束列");
  await expect(runner.getByLabel("参数名")).toHaveValue(/全局最大应力/);
});

test("creates a JSON path binding without using the file extension", async ({
  page,
}) => {
  const runner = page.locator("#program-runner");
  await runner.locator("input.file-input").setInputFiles({
    name: "results.data",
    mimeType: "text/plain",
    buffer: Buffer.from(
      '{"results":[{"maximum":12.5,"minimum":3.2}]}',
    ),
  });
  await runner
    .locator(".runner-file-select")
    .filter({ hasText: "results.data" })
    .click();

  await selectInRunner(page, "12.5");
  await addParameterFromContextMenu(page, "输出");
  await runner.getByRole("button", { name: "修改 12.5 定位" }).click();
  await runner.getByLabel("识别模式").selectOption("jsonPath");
  await runner.getByLabel("JSON 路径").fill("$.results[0].maximum");
  await runner.getByRole("button", { name: "应用定位" }).click();

  await expect(runner.locator(".runner-binding-meta")).toContainText(
    "JSON · $.results[0].maximum",
  );
});

test("locates and highlights the matching parameter row from an editor selection", async ({
  page,
}) => {
  const runner = page.locator("#program-runner");
  await runner.locator(".runner-load-example").click();

  await selectInRunner(
    page,
    "Maximum Number of Coefficient Loops = 10",
  );

  await expect(runner.locator(".runner-binding.is-located")).toHaveCount(1);
  await expect(
    runner.getByLabel("参数名"),
  ).toHaveValue("最大迭代步数");
  await expect(
    runner
      .locator(".runner-editor-shell .cm-variable-highlight")
      .filter({ hasText: /^10$/ }),
  ).toHaveCount(1);
  await expect(runner.locator(".runner-selection-bar > small")).toContainText(
    "已定位 · 最大迭代步数",
  );
});

test("double-clicking a highlighted value locates its parameter row", async ({
  page,
}) => {
  const runner = page.locator("#program-runner");
  await runner.locator(".runner-load-example").click();

  const highlight = runner
    .locator(".runner-editor-shell .cm-variable-highlight")
    .filter({ hasText: /^zhengqi$/ })
    .first();
  await expect(highlight).toBeVisible();
  await highlight.dblclick();

  await expect(runner.locator(".runner-binding.is-located")).toHaveCount(1);
  await expect(
    runner.getByLabel("参数名"),
  ).toHaveValue("CFX材料名");
});

test("edits an existing parameter locator and applies the new range", async ({
  page,
}) => {
  const runner = page.locator("#program-runner");
  await runner.locator("input.file-input").setInputFiles({
    name: "edit-locator.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("VALUE: 42\nSTATUS: OK\n"),
  });
  await runner
    .locator(".runner-file-select")
    .filter({ hasText: "edit-locator.txt" })
    .click();
  await selectInRunner(page, "42");
  await addParameterFromContextMenu(page, "输出");

  await runner.getByRole("button", { name: "修改 42 定位" }).click();
  await expect(runner.locator(".runner-locator-mode")).toHaveClass(
    /is-editing/,
  );
  await runner.getByLabel("识别模式").selectOption("fixedLength");
  await selectInRunner(page, "STATUS: OK");
  await expect(runner.getByLabel("识别模式")).toHaveValue("fixedLength");
  await expect(runner.getByLabel("起始行")).toHaveValue("2");
  await expect(runner.getByLabel("起始列")).toHaveValue("0");
  await expect(runner.getByLabel("结束行")).toHaveValue("2");
  await expect(runner.getByLabel("结束列")).toHaveValue("10");
  await runner.getByRole("button", { name: "应用定位" }).click();

  await expect(runner.locator(".runner-binding-meta")).toHaveText(
    "固定长度 · R2:C0",
  );
  await runner.getByRole("tab", { name: "参数属性" }).click();
  await expect(runner.getByLabel("参数文件")).toHaveCount(0);
  await expect(runner.getByLabel("参数定位信息")).toContainText(
    "起始行",
  );
  await expect(runner.getByLabel("参数定位信息")).toContainText(
    "起始列",
  );

  await runner.getByRole("button", { name: "修改 42 定位" }).click();
  await expect(runner.getByLabel("识别模式")).toHaveValue("fixedLength");
  await selectInRunner(page, "VALUE: 42");
  await expect(runner.getByLabel("识别模式")).toHaveValue("fixedLength");
});

test("loads and saves a folder project with files and launch configuration", async ({
  page,
  electronApp,
}) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "program-studio-project-"),
  );
  const projectDirectory = path.join(root, "工程 A");
  const sourceFile = path.join(root, "data.txt");
  await fs.mkdir(path.join(projectDirectory, "files"), { recursive: true });
  await fs.writeFile(sourceFile, "VALUE: 42\n", "utf8");
  await fs.writeFile(
    path.join(projectDirectory, "files", "001-data.txt"),
    "VALUE: 42\n",
    "utf8",
  );
  await writeJson(path.join(projectDirectory, "project.json"), {
    schema: "program-studio-folder-project",
    schemaVersion: 4,
    name: "工程 A",
    createdAt: "2026-11-05T00:00:00.000Z",
    updatedAt: "2026-11-05T00:00:00.000Z",
    launchFile: "launch.json",
    parameterFile: "parameters.json",
    outputFile: "outputs.json",
    files: [
      {
        path: sourceFile,
        relativePath: "files/001-data.txt",
        roles: ["input"],
      },
    ],
  });
  await writeJson(path.join(projectDirectory, "launch.json"), {
    mode: "direct",
    program: "C:\\Tools\\runner.exe",
    arguments: "--input data.txt",
    workingDirectory: root,
  });
  await writeJson(path.join(projectDirectory, "parameters.json"), {
    bindings: [
      {
        name: "VALUE",
        direction: "input",
        filePath: "files/001-data.txt",
        locator: {
          kind: "autoPosition",
          startRowIndex: 1,
          startColumnIndex: 7,
          endRowIndex: 1,
          endColumnIndex: 9,
        },
        value: "42",
        parameterType: "number",
        defaultValue: "40",
        unit: "MPa",
        description: "示例输入",
      },
    ],
  });
  await writeJson(path.join(projectDirectory, "outputs.json"), {
    outputs: [],
  });
  await electronApp.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory],
    });
  }, projectDirectory);
  const runner = page.locator("#program-runner");
  await runner
    .locator(".runner-project-actions")
    .getByRole("button", { name: "打开工程" })
    .click();

  await expect(runner.getByLabel("工程名称")).toHaveValue("工程 A");
  await runner.getByRole("tab", { name: "资源" }).click();
  await expect(runner.locator(".runner-file-item")).toHaveCount(1);
  await runner
    .locator(".runner-sidebar-tabs")
    .getByRole("tab", { name: /^参数/ })
    .click();
  await expect(runner.locator(".runner-binding")).toHaveCount(1);
  await runner.getByRole("tab", { name: "启动配置" }).click();
  await expect(
    runner
      .locator(".runner-field")
      .filter({ hasText: "程序路径" })
      .locator("input"),
  ).toHaveValue("C:\\Tools\\runner.exe");
  await runner.getByLabel("启动方式").selectOption("shell");
  await expect(runner.locator(".runner-project-path")).toContainText(
    projectDirectory,
  );
  await runner.getByRole("tab", { name: "参数属性" }).click();
  await expect(runner.getByLabel("参数类型")).toHaveValue("number");
  await expect(runner.getByLabel("参数默认值")).toHaveValue("40");
  await expect(runner.getByLabel("参数单位")).toHaveValue("MPa");
  await expect(runner.getByLabel("参数备注")).toHaveValue("示例输入");

  await runner.getByLabel("参数类型").selectOption("boolean");
  await runner.getByLabel("参数默认值").fill("false");
  await runner.getByLabel("参数单位").fill("bar");
  await runner.getByLabel("参数备注").fill("压力开关");
  await runner
    .locator(".runner-editor-shell .codemirror-host")
    .evaluate((element) => {
      const view = (element as HTMLElement & { __cmView?: any }).__cmView;
      if (!view) throw new Error("CodeMirror view not found");
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: "VALUE: 43\n",
        },
      });
    });

  await runner
    .getByText("添加自由参数", { exact: true })
    .click();
  await runner.getByRole("menuitem", { name: "自由输入" }).click();
  await runner.getByLabel("参数名").fill("材料");
  await runner.getByLabel("当前输入值").fill("steel");
  await runner
    .getByText("添加自由参数", { exact: true })
    .click();
  await runner.getByRole("menuitem", { name: "自由输出" }).click();
  await runner.getByLabel("参数名").fill("最终状态");
  await runner.getByLabel("手动输出值").fill("ok");

  await runner.getByRole("button", { name: "保存工程" }).click();
  await expect(runner.locator(".runner-notice")).toContainText("工程已保存");
  const saved = JSON.parse(
    await fs.readFile(path.join(projectDirectory, "parameters.json"), "utf8"),
  );
  const savedLaunch = JSON.parse(
    await fs.readFile(path.join(projectDirectory, "launch.json"), "utf8"),
  );
  const savedManifest = JSON.parse(
    await fs.readFile(path.join(projectDirectory, "project.json"), "utf8"),
  );
  expect(savedManifest.name).toBe("工程 A");
  expect(savedLaunch.mode).toBe("shell");
  expect(savedLaunch.arguments).toBe("--input data.txt");
  expect(savedLaunch.workingDirectory).toBe("files");
  expect(saved.bindings).toHaveLength(3);
  expect(saved.bindings[0]).toMatchObject({
    parameterType: "boolean",
    defaultValue: "43",
    value: "42",
    unit: "bar",
    description: "压力开关",
  });
  expect(saved.bindings[1]).toMatchObject({
    scope: "free",
    name: "材料",
    direction: "input",
    value: "steel",
    parameterType: "text",
  });
  expect(saved.bindings[1]).not.toHaveProperty("filePath");
  expect(saved.bindings[1]).not.toHaveProperty("locator");
  expect(saved.bindings[2]).toMatchObject({
    scope: "free",
    name: "最终状态",
    direction: "output",
    value: "ok",
    parameterType: "text",
  });
  expect(saved.bindings[2]).not.toHaveProperty("filePath");
  expect(saved.bindings[2]).not.toHaveProperty("locator");
  expect(
    await fs.readFile(
      path.join(projectDirectory, "files", "001-data.txt"),
      "utf8",
    ),
  ).toContain("VALUE: 43");
  expect(await fs.readFile(sourceFile, "utf8")).toBe("VALUE: 43\n");

  await runner
    .locator(".runner-editor-shell .codemirror-host")
    .evaluate((element) => {
      const view = (element as HTMLElement & { __cmView?: any }).__cmView;
      if (!view) throw new Error("CodeMirror view not found");
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: "VALUE: 44\n",
        },
      });
    });
  await runner.getByRole("button", { name: "另存为" }).click();
  await expect(runner.locator(".runner-notice")).toContainText("工程已另存为");
  expect(await fs.readFile(sourceFile, "utf8")).toBe("VALUE: 43\n");
});

test("switches themes and persists the preference", async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem("program-studio-theme"));
  await page.reload();

  await page.locator('summary[aria-label="切换主题"]').click();
  await page.getByRole("menuitemradio", { name: "暗色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.locator(".runner-editor-empty, .codemirror-host").first(),
  ).toBeVisible();
});

test("confirms before replacing a project with unsaved changes", async ({
  page,
  electronApp,
}) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "program-studio-unsaved-"),
  );
  const projectDirectory = path.join(root, "Unsaved");
  await fs.mkdir(projectDirectory);
  await writeJson(path.join(projectDirectory, "project.json"), {
    schema: "program-studio-folder-project",
    schemaVersion: 4,
    name: "未保存测试",
    createdAt: "2026-11-05T00:00:00.000Z",
    updatedAt: "2026-11-05T00:00:00.000Z",
    launchFile: "launch.json",
    parameterFile: "parameters.json",
    outputFile: "outputs.json",
    files: [],
  });
  await writeJson(path.join(projectDirectory, "launch.json"), {
    mode: "direct",
    program: "C:\\Tools\\runner.exe",
    arguments: "",
    workingDirectory: root,
  });
  await writeJson(path.join(projectDirectory, "parameters.json"), {
    bindings: [],
  });
  await writeJson(path.join(projectDirectory, "outputs.json"), {
    outputs: [],
  });
  await electronApp.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory],
    });
  }, projectDirectory);
  const runner = page.locator("#program-runner");
  const projectActions = runner.locator(".runner-project-actions");

  await projectActions.getByRole("button", { name: "打开工程" }).click();
  await expect(runner.getByLabel("工程名称")).toHaveValue("未保存测试");
  await expect(runner.getByLabel("有未保存的更改")).toHaveCount(0);

  await runner.getByLabel("工程名称").fill("修改后的工程");
  await expect(runner.getByLabel("有未保存的更改")).toBeVisible();
  await projectActions.getByRole("button", { name: "打开工程" }).click();

  await expect(
    page.getByRole("dialog", { name: "打开其他工程？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回编辑" }).click();
  await expect(runner.getByLabel("工程名称")).toHaveValue("修改后的工程");
});

test("creates a new empty project after confirming unsaved changes", async ({
  page,
}) => {
  const runner = page.locator("#program-runner");
  const projectActions = runner.locator(".runner-project-actions");

  await runner.locator(".runner-load-example").click();
  await runner.getByLabel("工程名称").fill("修改后的默认工程");
  await expect(runner.getByLabel("有未保存的更改")).toBeVisible();

  await page.keyboard.press("Control+n");
  const dialog = page.getByRole("dialog", { name: "新建空白工程？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "返回编辑" }).click();
  await expect(runner.getByLabel("工程名称")).toHaveValue("修改后的默认工程");

  await projectActions.getByRole("button", { name: "新建工程" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "放弃并新建" }).click();

  await expect(runner.getByLabel("工程名称")).toHaveValue("未命名工程");
  await expect(runner.getByLabel("有未保存的更改")).toHaveCount(0);
  await expect(runner.locator(".runner-project-path")).toHaveText(
    "尚未保存到工程目录",
  );
  await expect(runner.locator(".runner-file-item")).toHaveCount(0);
  await expect(runner.locator(".runner-editor-empty")).toBeVisible();
  await expect(runner.locator(".runner-notice")).toContainText(
    "已新建空白工程",
  );

  await runner.getByRole("tab", { name: "启动配置" }).click();
  await expect(
    runner
      .locator(".runner-field")
      .filter({ hasText: "程序路径" })
      .locator("input"),
  ).toHaveValue("");
});

test("adapts the workspace controls at the minimum desktop width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 680 });

  const runner = page.locator("#program-runner");
  await expect(runner.locator(".runner-files")).toBeVisible();
  await runner.locator(".inspector-toggle").click();
  await expect(runner).toHaveClass(/is-inspector-open/);
  await expect(
    runner.getByRole("complementary", { name: "检查器" }),
  ).toBeVisible();

  if (await runner.getByLabel("展开底部面板").count()) {
    await runner.getByLabel("展开底部面板").click();
  }
  await runner.getByLabel("收起底部面板").click();
  await expect(runner).toHaveClass(/is-dock-collapsed/);
  await runner.getByLabel("展开底部面板").click();
  await expect(runner).not.toHaveClass(/is-dock-collapsed/);

  const explorerResizer = runner.getByRole("separator", {
    name: "调整文件面板宽度",
  });
  const widthBefore = await runner.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--explorer-width").trim(),
  );
  await explorerResizer.focus();
  await explorerResizer.press("ArrowRight");
  await expect
    .poll(() =>
      runner.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--explorer-width").trim(),
      ),
    )
    .not.toBe(widthBefore);
});

