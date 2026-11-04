import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const FIXTURE_ROOT = path.resolve("testData");

async function loadFixture(page: Page, filename: string) {
  await page.locator("input.file-input").setInputFiles(
    path.join(FIXTURE_ROOT, filename),
  );
  await expect(page.locator(".file-status strong")).toHaveText(filename);
  await expect(page.locator(".cm-content")).toContainText(/\S/);
}

async function selectText(
  page: Page,
  text: string,
  occurrence = 0,
) {
  const selected = await page.locator(".codemirror-host").evaluate(
    (host, input) => {
      const view = (host as HTMLElement & { __cmView?: any }).__cmView;
      if (!view) throw new Error("CodeMirror view not found");
      const source = view.state.doc.toString();
      let cursor = 0;
      let index = -1;
      for (let count = 0; count <= input.occurrence; count += 1) {
        index = source.indexOf(input.text, cursor);
        if (index < 0) break;
        cursor = index + input.text.length;
      }
      if (index < 0) throw new Error(`Selected text not found: ${input.text}`);

      view.focus();
      view.dispatch({
        selection: {
          anchor: index,
          head: index + input.text.length,
        },
        scrollIntoView: true,
      });
      return source.slice(index, index + input.text.length);
    },
    { text, occurrence },
  );

  expect(selected).toBe(text);
  await expect(page.locator(".cm-variable-highlight")).toHaveText(text);
  await expect(page.locator(".current-match code")).toHaveText(text);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Variable Studio/);
  await expect(page.locator(".file-status strong")).toHaveText("workbench.wbjn");
  await expect(page.locator(".cm-content")).toContainText("# encoding");
});

test("associates a selected Python value with its variable context", async ({
  page,
}) => {
  await loadFixture(page, "Mechanical_Thermal.py");
  await selectText(page, '"material1"');

  await expect(page.locator(".variable-values > span").first()).toContainText(
    "body.Material",
  );
  await expect(page.locator(".variable-context > strong")).toContainText(
    "target_body_name = fati",
  );
  await expect(page.locator(".match-item strong")).toHaveText('"material1"');
});

test("locates the content of a Python raw string without its syntax", async ({
  page,
}) => {
  const scriptPath = "J:\\ST\\AW\\fa\\fa1\\GSP\\CFX_setup_0.ccl";
  await selectText(page, scriptPath, 1);

  await expect(page.locator(".variable-values > span").first()).toContainText(
    "dsScriptFileCFX2",
  );
  await expect(page.locator(".match-item strong")).toHaveText(scriptPath);
});

test("uses selected content and the enclosing call context for array arguments", async ({
  page,
}) => {
  await selectText(page, "7930 [kg m^-3]");

  await expect(page.locator(".variable-values > span").nth(0)).toContainText(
    "Values",
  );
  await expect(page.locator(".variable-values > span").nth(1)).toContainText(
    "7930 [kg m^-3]",
  );
  await expect(page.locator(".variable-values > span").nth(2)).toContainText(
    '[["7930 [kg m^-3]"]]',
  );
  await expect(page.locator(".variable-context > strong")).toContainText(
    "matlProp1.SetData(...)",
  );
  await expect(page.locator(".variable-context > strong")).not.toContainText(
    "ccl_out",
  );
});

test("keeps the highlight layer aligned with the text layer after locating", async ({
  page,
}) => {
  await selectText(page, "Engineering Data");
  await page.getByRole("button", { name: "回到当前选中内容" }).click();

  const metrics = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".cm-editor");
    const scroller = document.querySelector<HTMLElement>(".cm-scroller");
    const mark = document.querySelector<HTMLElement>(".cm-variable-highlight");
    if (!editor || !scroller || !mark) throw new Error("Editor layers missing");
    const editorRect = editor.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    return {
      markTop: markRect.top,
      markBottom: markRect.bottom,
      editorTop: editorRect.top,
      editorBottom: editorRect.bottom,
      hasLegacyOverlay: Boolean(document.querySelector(".text-highlight")),
      scrollTop: scroller.scrollTop,
    };
  });

  expect(metrics.hasLegacyOverlay).toBe(false);
  expect(metrics.markTop).toBeGreaterThanOrEqual(metrics.editorTop);
  expect(metrics.markBottom).toBeLessThanOrEqual(metrics.editorBottom);
});

test("associates a selected CCL value with its material and property path", async ({
  page,
}) => {
  await loadFixture(page, "CFX1.ccl");
  await selectText(page, "4181.7");

  await expect(page.locator(".variable-values > span").first()).toContainText(
    "Specific Heat Capacity",
  );
  await expect(page.locator(".variable-context > strong")).toContainText(
    "MATERIAL: Water",
  );
  await expect(page.locator(".variable-context > strong")).toContainText(
    "SPECIFIC HEAT CAPACITY",
  );
});
