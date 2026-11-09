import type { ProjectInputOverride } from "./projectExecution.ts";

export const RUN_REQUEST_SCHEMA = "program-studio-run-request";
export const RUN_REQUEST_VERSION = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} 必须是非空字符串。`);
  }
  return value;
}

function parseOverride(
  value: unknown,
  index: number,
): ProjectInputOverride {
  if (
    !isRecord(value) ||
    !isRecord(value.selector) ||
    typeof value.value !== "string"
  ) {
    throw new Error(`第 ${index + 1} 个覆盖项结构无效。`);
  }
  const selector = value.selector;
  if (selector.type === "parameter") {
    return {
      fileName: requiredString(
        selector.fileName,
        `overrides[${index}].selector.fileName`,
      ),
      parameterName: requiredString(
        selector.parameterName,
        `overrides[${index}].selector.parameterName`,
      ),
      value: value.value,
    };
  }
  throw new Error(
    `第 ${index + 1} 个覆盖选择器类型无效，应为 parameter。`,
  );
}

export function parseRunRequest(
  payload: unknown,
): ProjectInputOverride[] {
  if (
    !isRecord(payload) ||
    payload.schema !== RUN_REQUEST_SCHEMA ||
    payload.schemaVersion !== RUN_REQUEST_VERSION ||
    !Array.isArray(payload.overrides)
  ) {
    throw new Error(
      `运行请求必须是 ${RUN_REQUEST_SCHEMA} v${RUN_REQUEST_VERSION} JSON。`,
    );
  }
  return payload.overrides.map(parseOverride);
}
