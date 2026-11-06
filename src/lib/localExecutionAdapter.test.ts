import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalExecutionAdapter } from "./localExecutionAdapter.ts";

test("local executor refuses file access outside the generated project", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "regparser-adapter-"),
  );
  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), "regparser-outside-"),
  );
  try {
    const adapter = createLocalExecutionAdapter({
      writableRoot: root,
    });
    const outsideFile = path.join(outside, "input.txt");
    await fs.writeFile(outsideFile, "outside", "utf8");

    await assert.rejects(
      () => adapter.readFile(outsideFile),
      /路径不在生成工程内/,
    );
    await assert.rejects(
      () =>
        adapter.writeFiles([
          { path: outsideFile, content: "changed" },
        ]),
      /路径不在生成工程内/,
    );
    assert.equal(await fs.readFile(outsideFile, "utf8"), "outside");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
