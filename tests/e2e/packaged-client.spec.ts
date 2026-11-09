import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

test("packaged client renders the program workspace", async () => {
  test.skip(
    process.env.PROGRAM_STUDIO_PACKAGED !== "1",
    "Run after npm run package:dir",
  );
  const executablePath = path.resolve(
    "release-client/win-unpacked/Program Studio.exe",
  );
  await fs.access(executablePath);
  const app = await electron.launch({ executablePath });
  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle(/Program Studio/);
    await expect(
      page.getByText("本机程序工作台"),
    ).toBeVisible();
    await expect(page.locator("#program-runner")).toBeVisible();
  } finally {
    await app.close();
  }
});
