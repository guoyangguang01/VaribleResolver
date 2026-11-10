import assert from "node:assert/strict";
import test from "node:test";
import { remapReferenceFile } from "./programWorkspace.ts";

test("remaps only extensionless file references after a file rename", () => {
  assert.equal(
    remapReferenceFile(
      "@old[In].pressure",
      "C:\\case\\old.ccl",
      "C:\\case\\new.cse",
    ),
    "@new[In].pressure",
  );
  assert.equal(
    remapReferenceFile(
      "@old[Out].pressure",
      "C:\\case\\old.ccl",
      "C:\\case\\new.cse",
    ),
    "@new[Out].pressure",
  );
  assert.equal(
    remapReferenceFile(
      "@old.ccl[In].pressure",
      "C:\\case\\old.ccl",
      "C:\\case\\new.cse",
    ),
    "@old.ccl[In].pressure",
  );
});
