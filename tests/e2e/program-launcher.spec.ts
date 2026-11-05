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

async function replaceInRunner(
  page: Page,
  previous: string,
  next: string,
) {
  await page
    .locator("#program-runner .runner-editor-shell .codemirror-host")
    .evaluate(
      (element, input) => {
        const view = (element as HTMLElement & { __cmView?: any })
          .__cmView;
        if (!view) throw new Error("CodeMirror view not found");
        const source = view.state.doc.toString();
        const start = source.indexOf(input.previous);
        if (start < 0) throw new Error(`Text not found: ${input.previous}`);
        view.dispatch({
          changes: {
            from: start,
            to: start + input.previous.length,
            insert: input.next,
          },
        });
      },
      { previous, next },
    );
}

test("binds a file input, writes it back, and extracts a changed output", async ({
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
  await fileButton.click();
  await expect(
    runner.locator(".runner-editor-heading strong"),
  ).toHaveText("result.txt");

  await selectInRunner(page, "initial");
  await runner.getByRole("button", { name: "+ 输入参数" }).click();
  const inputValue = runner
    .locator(".runner-binding.is-input .runner-binding-value")
    .first();
  await expect(inputValue).toHaveValue("initial");
  await inputValue.fill("changed");
  await runner.getByRole("button", { name: "写回全部输入" }).click();

  await expect(
    runner.locator(".runner-editor-shell .cm-content"),
  ).toContainText("INPUT: changed");
  await expect(runner.locator(".runner-notice")).toContainText(
    "1 个输入值写回",
  );

  await selectInRunner(page, "12.5");
  await runner.getByRole("button", { name: "+ 输出参数" }).click();
  await replaceInRunner(page, "12.5", "99.5");
  await runner.getByRole("button", { name: "提取输出参数" }).click();

  await expect(
    runner.locator(".runner-binding.is-output .runner-output-value"),
  ).toContainText("99.5");
  await expect(runner.locator(".runner-notice")).toContainText(
    "已提取 1 个输出参数",
  );
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

  await expect(runner.locator(".runner-file-item")).toHaveCount(7);
  await expect(runner.locator(".runner-binding")).toHaveCount(152);
  await expect(runner.locator(".runner-binding.is-input")).toHaveCount(138);
  await expect(runner.locator(".runner-binding.is-output")).toHaveCount(14);
  await expect(
    runner
      .locator(".runner-editor-shell .cm-variable-highlight")
      .first(),
  ).toBeVisible();
  await expect(
    runner.locator(".runner-file-select").filter({
      hasText: "C:\\Cases\\fa1\\Stress_Envelope_Summary.txt",
    }),
  ).toBeVisible();
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

  await runner.getByRole("button", { name: "提取输出参数" }).click();
  await expect(
    runner
      .locator(".runner-binding.is-output")
      .nth(4)
      .locator(".runner-output-value"),
  ).toContainText("3.31996114e+08");
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

  await runner.getByLabel("识别模式").selectOption("jsonPath");
  await runner.getByLabel("JSON 路径").fill("$.results[0].maximum");
  await runner.getByRole("button", { name: "+ 输出参数" }).click();

  await expect(runner.locator(".runner-binding-meta")).toContainText(
    "JSON · $.results[0].maximum",
  );
  await runner.getByRole("button", { name: "提取输出参数" }).click();
  await expect(
    runner.locator(".runner-binding.is-output .runner-output-value"),
  ).toContainText("12.5");
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
    runner
      .locator(".runner-binding.is-located .runner-parameter-name input"),
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
    runner
      .locator(".runner-binding.is-located .runner-parameter-name input"),
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
  await runner.getByRole("button", { name: "+ 输出参数" }).click();

  await runner.getByRole("button", { name: "修改 42 定位" }).click();
  await expect(runner.locator(".runner-locator-mode")).toHaveClass(
    /is-editing/,
  );
  await selectInRunner(page, "STATUS: OK");
  await expect(runner.getByLabel("识别模式")).toHaveValue("auto");
  await runner.getByRole("button", { name: "应用定位" }).click();

  await expect(runner.locator(".runner-binding-meta")).toHaveText(
    "自动 · R2:C0",
  );
  await runner.getByRole("button", { name: "提取输出参数" }).click();
  await expect(
    runner.locator(".runner-binding.is-output .runner-output-value"),
  ).toContainText("STATUS: OK");
});

test("loads and saves a folder project with files and launch configuration", async ({
  page,
}) => {
  const project = {
    folderPath: "D:\\Projects\\工程 A",
    manifest: {
      schema: "program-studio-folder-project",
      schemaVersion: 1,
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
      saveProject: async (payload: any) => {
        (window as any).__savedProject = payload;
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
  await runner.getByRole("button", { name: "打开工程" }).click();

  await expect(runner.getByLabel("工程名称")).toHaveValue("工程 A");
  await expect(runner.locator(".runner-file-item")).toHaveCount(1);
  await expect(runner.locator(".runner-binding")).toHaveCount(1);
  await expect(
    runner
      .locator(".runner-field")
      .filter({ hasText: "程序路径" })
      .locator("input"),
  ).toHaveValue("D:\\Tools\\runner.exe");
  await expect(runner.locator(".runner-project-path")).toContainText(
    "D:\\Projects\\工程 A",
  );

  await runner.getByRole("button", { name: "保存工程" }).click();
  const saved = await page.evaluate(() => (window as any).__savedProject);
  expect(saved.folderName).toBe("工程 A");
  expect(saved.launch.arguments).toBe("--input data.txt");
  expect(saved.parameters.bindings).toHaveLength(1);
  expect(saved.files[0].content).toContain("VALUE: 42");
});

