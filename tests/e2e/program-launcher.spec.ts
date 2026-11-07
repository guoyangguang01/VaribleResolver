import { expect, test, type Page } from "@playwright/test";

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

test("creates input and output bindings from the editor context menu", async ({
  page,
}) => {
  await page.goto("/#/program");
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

test("builds a quoted launch command from the program profile", async ({
  page,
}) => {
  await page.goto("/#/program");
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
  await page.goto("/#/program");
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
  await page.goto("/#/program");
  const runner = page.locator("#program-runner");
  await runner.getByRole("button", { name: "加载 fa1 标准示例" }).click();

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
  await expect(
    runner.locator(".runner-file-select").filter({
      hasText: "C:\\Cases\\fa1\\Stress_Envelope_Summary.txt",
    }),
  ).toBeVisible();
  await runner
    .locator(".runner-sidebar-tabs")
    .getByRole("tab", { name: /^参数/ })
    .click();
  await runner.getByRole("tab", { name: "启动配置" }).click();
  await expect(
    runner
      .locator(".runner-field")
      .filter({ hasText: "程序路径" })
      .locator("input"),
  ).toHaveValue(
    "C:\\Program Files\\ANSYS Inc\\v195\\Framework\\bin\\Win64\\RunWB2.exe",
  );
  await expect(runner.locator(".runner-notice")).toContainText(
    "7 个路径文件，152 个标准参数",
  );

  await runner
    .getByRole("treeitem", {
      name: "输出参数 自由参数 · CFX速度云图",
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
  await page.goto("/#/program");
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

  await runner.getByRole("tab", { name: "定位规则" }).click();
  await runner.getByLabel("识别模式").selectOption("jsonPath");
  await runner.getByLabel("JSON 路径").fill("$.results[0].maximum");
  await addParameterFromContextMenu(page, "输出");

  await expect(runner.locator(".runner-binding-meta")).toContainText(
    "JSON · $.results[0].maximum",
  );
});

test("locates and highlights the matching parameter row from an editor selection", async ({
  page,
}) => {
  await page.goto("/#/program");
  const runner = page.locator("#program-runner");
  await runner.getByRole("button", { name: "加载 fa1 标准示例" }).click();

  await selectInRunner(
    page,
    "Maximum Number of Coefficient Loops = 10",
  );

  await expect(runner.locator(".runner-binding.is-located")).toHaveCount(1);
  await expect(
    runner.getByLabel("参数名"),
  ).toHaveValue("CFX1[In] · 最大迭代步数");
  await expect(
    runner
      .locator(".runner-editor-shell .cm-variable-highlight")
      .filter({ hasText: /^10$/ }),
  ).toHaveCount(1);
  await expect(runner.locator(".runner-selection-bar > small")).toContainText(
    "已定位 · CFX1[In] · 最大迭代步数",
  );
});

test("double-clicking a highlighted value locates its parameter row", async ({
  page,
}) => {
  await page.goto("/#/program");
  const runner = page.locator("#program-runner");
  await runner.getByRole("button", { name: "加载 fa1 标准示例" }).click();

  const highlight = runner
    .locator(".runner-editor-shell .cm-variable-highlight")
    .filter({ hasText: /^zhengqi$/ })
    .first();
  await expect(highlight).toBeVisible();
  await highlight.dblclick();

  await expect(runner.locator(".runner-binding.is-located")).toHaveCount(1);
  await expect(
    runner.getByLabel("参数名"),
  ).toHaveValue("CFX1[In] · CFX材料名");
});

test("edits an existing parameter locator and applies the new range", async ({
  page,
}) => {
  await page.goto("/#/program");
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
  await selectInRunner(page, "STATUS: OK");
  await expect(runner.getByLabel("识别模式")).toHaveValue("auto");
  await expect(runner.getByLabel("自动定位 Token 预览")).toContainText(
    "Token 数量",
  );
  await runner.getByRole("button", { name: "应用定位" }).click();

  await expect(runner.locator(".runner-binding-meta")).toHaveText(
    "自动 · R2:C0",
  );
  await runner.getByRole("tab", { name: "参数属性" }).click();
  await expect(runner.getByLabel("参数定位信息")).toContainText(
    "Token 定位",
  );
});

test("loads and saves a folder project with files and launch configuration", async ({
  page,
}) => {
  const project = {
    folderPath: "D:\\Projects\\工程 A",
    manifest: {
      schema: "program-studio-folder-project",
      schemaVersion: 2,
      name: "工程 A",
      createdAt: "2026-11-05T00:00:00.000Z",
      updatedAt: "2026-11-05T00:00:00.000Z",
      launchFile: "launch.json",
      parameterFile: "parameters.json",
      files: [
        {
          path: "D:\\Cases\\data.txt",
          relativePath: "files/001-data.txt",
        },
      ],
    },
    launch: {
      program: "D:\\Tools\\runner.exe",
      arguments: "--input data.txt",
      workingDirectory: "D:\\Cases",
    },
    parameters: {
      bindings: [
        {
          id: "value",
          name: "VALUE",
          direction: "input",
          filePath: "D:\\Cases\\data.txt",
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
    },
    files: [
      {
        relativePath: "files/001-data.txt",
        content: "VALUE: 42\n",
      },
    ],
  };

  await page.addInitScript((projectPayload) => {
    (window as any).programStudio = {
      isDesktop: true,
      selectFiles: async () => [],
      readFiles: async () => [],
      writeFiles: async () => [],
      updateFiles: async (files: any[]) => {
        (window as any).__updatedFiles = [
          ...((window as any).__updatedFiles ?? []),
          files,
        ];
        return files.map((file) => file.path);
      },
      saveProject: async (payload: any, options: any) => {
        (window as any).__savedProject = payload;
        (window as any).__savedProjectOptions = options;
        return {
          path: `D:\\Projects\\${payload.folderName}`,
          name: payload.manifest.name,
        };
      },
      openProject: async () => projectPayload,
      runProgram: async () => ({
        status: "completed",
        exitCode: 0,
        signal: null,
        error: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
      }),
    };
  }, project);

  await page.goto("/");
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
  ).toHaveValue("D:\\Tools\\runner.exe");
  await expect(runner.locator(".runner-project-path")).toContainText(
    "D:\\Projects\\工程 A",
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

  await runner.getByRole("button", { name: "保存工程" }).click();
  const saved = await page.evaluate(() => (window as any).__savedProject);
  const saveOptions = await page.evaluate(
    () => (window as any).__savedProjectOptions,
  );
  expect(saved.folderName).toBe("工程 A");
  expect(saved.launch.arguments).toBe("--input data.txt");
  expect(saved.parameters.bindings).toHaveLength(1);
  expect(saved.parameters.bindings[0]).toMatchObject({
    parameterType: "boolean",
    defaultValue: "false",
    unit: "bar",
    description: "压力开关",
  });
  expect(saved.files[0].content).toContain("VALUE: 43");
  expect(saveOptions).toEqual({
    mode: "save",
    path: "D:\\Projects\\工程 A",
  });
  expect(
    await page.evaluate(() => (window as any).__updatedFiles),
  ).toEqual([
    [
      {
        path: "D:\\Cases\\data.txt",
        content: "VALUE: 43\n",
      },
    ],
  ]);

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
  const saveAsOptions = await page.evaluate(
    () => (window as any).__savedProjectOptions,
  );
  expect(saveAsOptions).toEqual({ mode: "saveAs" });
  expect(
    await page.evaluate(() => (window as any).__updatedFiles),
  ).toHaveLength(1);
});

test("switches themes and persists the preference", async ({ page }) => {
  await page.goto("/");
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
}) => {
  const project = {
    folderPath: "D:\\Projects\\Unsaved",
    manifest: {
      schema: "program-studio-folder-project",
      schemaVersion: 2,
      name: "未保存测试",
      createdAt: "2026-11-05T00:00:00.000Z",
      updatedAt: "2026-11-05T00:00:00.000Z",
      launchFile: "launch.json",
      parameterFile: "parameters.json",
      files: [],
    },
    launch: {
      program: "D:\\Tools\\runner.exe",
      arguments: "",
      workingDirectory: "D:\\Projects",
    },
    parameters: { bindings: [] },
    files: [],
  };

  await page.addInitScript((payload) => {
    (window as any).programStudio = {
      isDesktop: true,
      selectFiles: async () => [],
      readFiles: async () => [],
      writeFiles: async () => [],
      updateFiles: async () => [],
      saveProject: async () => null,
      openProject: async () => payload,
      runProgram: async () => ({
        status: "completed",
        exitCode: 0,
        signal: null,
        error: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
      }),
      setDirty: () => undefined,
      setTheme: () => undefined,
    };
  }, project);

  await page.goto("/");
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

test("adapts the workspace controls at the minimum desktop width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 680 });
  await page.goto("/");

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

