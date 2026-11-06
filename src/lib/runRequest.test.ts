import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRunRequest,
  RUN_REQUEST_SCHEMA,
  RUN_REQUEST_VERSION,
} from "./runRequest.ts";

test("parses binding ID and name input overrides", () => {
  const overrides = parseRunRequest({
    schema: RUN_REQUEST_SCHEMA,
    schemaVersion: RUN_REQUEST_VERSION,
    overrides: [
      {
        selector: { type: "bindingId", id: "parameter-id" },
        value: "20",
      },
      {
        selector: { type: "name", name: "入口温度" },
        value: "550",
      },
    ],
  });

  assert.deepEqual(overrides, [
    {
      target: "bindingId",
      bindingId: "parameter-id",
      value: "20",
    },
    {
      target: "name",
      name: "入口温度",
      value: "550",
    },
  ]);
});

test("rejects invalid run request selectors and values", () => {
  assert.throws(
    () =>
      parseRunRequest({
        schema: RUN_REQUEST_SCHEMA,
        schemaVersion: RUN_REQUEST_VERSION,
        overrides: [
          {
            selector: { type: "path", value: "x" },
            value: "1",
          },
        ],
      }),
    /选择器类型无效/,
  );
  assert.throws(
    () =>
      parseRunRequest({
        schema: RUN_REQUEST_SCHEMA,
        schemaVersion: RUN_REQUEST_VERSION,
        overrides: [
          {
            selector: { type: "bindingId", id: "parameter-id" },
            value: 1,
          },
        ],
      }),
    /覆盖项结构无效/,
  );
});
