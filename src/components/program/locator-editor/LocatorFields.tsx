import type { ComponentType } from "react";
import type { LaunchLocatorMode } from "../../../lib/launcher";
import type { LocatorFieldProps } from "./types";

interface NumberFieldProps extends Pick<LocatorFieldProps, "updateLocatorValue"> {
  field: "startRowIndex" | "startColumnIndex" | "endRowIndex" | "endColumnIndex";
  label: string;
  min: number;
  values: LocatorFieldProps["values"];
}

function NumberField({
  field,
  label,
  min,
  updateLocatorValue,
  values,
}: NumberFieldProps) {
  const fallback = field === "startRowIndex" ||
    field === "endRowIndex"
    ? 1
    : 0;
  return (
    <label className="runner-field">
      <span>{label}</span>
      <input
        min={min}
        onChange={(event) =>
          updateLocatorValue(field, Number(event.target.value))
        }
        type="number"
        value={values[field] ?? fallback}
      />
    </label>
  );
}

function AutoLocatorFields(props: LocatorFieldProps) {
  return (
    <div className="runner-mode-grid">
      <NumberField {...props} field="startRowIndex" label="起始行" min={1} />
      <NumberField
        {...props}
        field="startColumnIndex"
        label="起始列"
        min={0}
      />
      <NumberField {...props} field="endRowIndex" label="结束行" min={1} />
      <NumberField
        {...props}
        field="endColumnIndex"
        label="结束列"
        min={0}
      />
    </div>
  );
}

function FixedLengthLocatorFields(props: LocatorFieldProps) {
  return <AutoLocatorFields {...props} />;
}

function StartColumnLocatorFields(props: LocatorFieldProps) {
  return (
    <div className="runner-mode-grid">
      <NumberField {...props} field="startRowIndex" label="起始行" min={1} />
      <NumberField
        {...props}
        field="startColumnIndex"
        label="起始列"
        min={0}
      />
    </div>
  );
}

function WholeLineLocatorFields(props: LocatorFieldProps) {
  return (
    <div className="runner-mode-grid">
      <NumberField {...props} field="startRowIndex" label="起始行" min={1} />
    </div>
  );
}

function MultiLineLocatorFields(props: LocatorFieldProps) {
  return (
    <div className="runner-mode-grid">
      <NumberField {...props} field="startRowIndex" label="起始行" min={1} />
      <NumberField {...props} field="endRowIndex" label="结束行" min={1} />
    </div>
  );
}

function DelimitedLocatorFields({
  updateLocatorValue,
  values,
}: LocatorFieldProps) {
  return (
    <div className="runner-mode-grid">
      <NumberField
        updateLocatorValue={updateLocatorValue}
        values={values}
        field="startRowIndex"
        label="起始行"
        min={1}
      />
      <label className="runner-field">
        <span>分隔符</span>
        <input
          onChange={(event) =>
            updateLocatorValue("separator", event.target.value)
          }
          placeholder="例如 \t 或 ,"
          value={values.separator ?? ""}
        />
      </label>
      <label className="runner-field">
        <span>分段序号</span>
        <input
          min="0"
          onChange={(event) =>
            updateLocatorValue("fieldIndex", Number(event.target.value))
          }
          type="number"
          value={values.fieldIndex ?? 0}
        />
      </label>
    </div>
  );
}

function MarkerLocatorFields({
  updateLocatorValue,
  values,
}: LocatorFieldProps) {
  return (
    <>
      <div className="runner-mode-grid">
        <label className="runner-field">
          <span>起始标记</span>
          <input
            onChange={(event) =>
              updateLocatorValue("startMarker", event.target.value)
            }
            placeholder="例如 RESULT_BEGIN"
            value={values.startMarker ?? ""}
          />
        </label>
        <label className="runner-field">
          <span>结束标记</span>
          <input
            onChange={(event) =>
              updateLocatorValue("endMarker", event.target.value)
            }
            placeholder="例如 RESULT_END"
            value={values.endMarker ?? ""}
          />
        </label>
      </div>
      <label className="runner-field">
        <span>出现序号</span>
        <input
          min="0"
          onChange={(event) =>
            updateLocatorValue("occurrence", Number(event.target.value))
          }
          type="number"
          value={values.occurrence ?? 0}
        />
      </label>
    </>
  );
}

function JsonPathLocatorFields({
  updateLocatorValue,
  values,
}: LocatorFieldProps) {
  return (
    <label className="runner-field">
      <span>JSON 路径</span>
      <input
        onChange={(event) =>
          updateLocatorValue("jsonPath", event.target.value)
        }
        placeholder="$.results[0].maximum"
        value={values.jsonPath ?? "$"}
      />
    </label>
  );
}

function XmlPathLocatorFields({
  updateLocatorValue,
  values,
}: LocatorFieldProps) {
  return (
    <label className="runner-field">
      <span>XML 路径</span>
      <input
        onChange={(event) =>
          updateLocatorValue("xmlPath", event.target.value)
        }
        placeholder="/results/stress[1]/@maximum"
        value={values.xmlPath ?? ""}
      />
    </label>
  );
}

function PatternLocatorFields({
  updateLocatorValue,
  values,
}: LocatorFieldProps) {
  return (
    <>
      <div className="runner-mode-grid">
        <label className="runner-field runner-mode-wide">
          <span>正则表达式</span>
          <input
            onChange={(event) =>
              updateLocatorValue("pattern", event.target.value)
            }
            placeholder="maximum\\s*=\\s*([\\d.e+-]+)"
            value={values.pattern ?? ""}
          />
        </label>
        <label className="runner-field">
          <span>标志</span>
          <input
            onChange={(event) =>
              updateLocatorValue("flags", event.target.value)
            }
            placeholder="i"
            value={values.flags ?? ""}
          />
        </label>
        <label className="runner-field">
          <span>捕获组</span>
          <input
            min="0"
            onChange={(event) =>
              updateLocatorValue("captureGroup", Number(event.target.value))
            }
            type="number"
            value={values.captureGroup ?? 0}
          />
        </label>
      </div>
      <label className="runner-field">
        <span>出现序号</span>
        <input
          min="0"
          onChange={(event) =>
            updateLocatorValue("occurrence", Number(event.target.value))
          }
          type="number"
          value={values.occurrence ?? 0}
        />
      </label>
    </>
  );
}

export const LOCATOR_FIELD_EDITORS: Record<
  LaunchLocatorMode,
  ComponentType<LocatorFieldProps>
> = {
  auto: AutoLocatorFields,
  fixedLength: FixedLengthLocatorFields,
  delimited: DelimitedLocatorFields,
  startColumn: StartColumnLocatorFields,
  wholeLine: WholeLineLocatorFields,
  multiLine: MultiLineLocatorFields,
  indefiniteLine: MarkerLocatorFields,
  jsonPath: JsonPathLocatorFields,
  xmlPath: XmlPathLocatorFields,
  pattern: PatternLocatorFields,
};
