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
}

export const test = base.extend<ElectronFixtures>({
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
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForSelector("#program-runner", { state: "attached" });
    await use(page);
  },
});

export { expect };
