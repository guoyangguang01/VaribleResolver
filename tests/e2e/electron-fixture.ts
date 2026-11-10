import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

interface ElectronFixtures {
  electronApp: ElectronApplication;
  page: Page;
  startWithDefaultProject: boolean;
}

export const test = base.extend<ElectronFixtures>({
  startWithDefaultProject: [false, { option: true }],
  electronApp: async ({}, use) => {
    const app = await electron.launch({
      args: [process.cwd()],
      cwd: process.cwd(),
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: "http://127.0.0.1:4173",
      },
    });
    await use(app);
    for (const window of app.windows()) {
      await window
        .evaluate(() => window.programStudio?.setDirty(false))
        .catch(() => undefined);
    }
    await app.close();
  },
  page: async ({ electronApp, startWithDefaultProject }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForSelector("#program-runner", { state: "attached" });
    const runner = page.locator("#program-runner");
    await expect(runner.getByLabel("工程名称")).toHaveValue(
      "fa1 标准执行示例",
    );
    if (!startWithDefaultProject) {
      await runner
        .locator(".runner-project-actions")
        .getByRole("button", { name: "新建工程" })
        .click();
      await expect(runner.getByLabel("工程名称")).toHaveValue("未命名工程");
    }
    await use(page);
  },
});

export { expect };
