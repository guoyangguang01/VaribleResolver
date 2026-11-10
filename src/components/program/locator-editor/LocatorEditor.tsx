import {
  LOCATOR_MODE_OPTIONS,
} from "../../../lib/locators/registry";
import type { LaunchLocatorMode } from "../../../lib/launcher";
import { LOCATOR_FIELD_EDITORS } from "./LocatorFields";
import type { LocatorEditorProps } from "./types";

export function LocatorEditor({
  locatorMode,
  locatorModeValues,
  onApplyLocator,
  onCancelLocator,
  setLocatorMode,
  updateLocatorValue,
}: LocatorEditorProps) {
  const Fields = LOCATOR_FIELD_EDITORS[locatorMode];
  return (
    <div className="runner-locator-mode is-editing">
      <div className="runner-locator-heading">
        <div>
          <span>定位规则</span>
          <strong>识别模式</strong>
        </div>
      </div>
      <label className="runner-field">
        <select
          aria-label="识别模式"
          onChange={(event) =>
            setLocatorMode(event.target.value as LaunchLocatorMode)
          }
          value={locatorMode}
        >
          {LOCATOR_MODE_OPTIONS.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>
      <Fields
        updateLocatorValue={updateLocatorValue}
        values={locatorModeValues}
      />
      <div className="runner-locator-edit-actions">
        <button
          className="runner-locator-apply"
          onClick={onApplyLocator}
          type="button"
        >
          应用定位
        </button>
        <button
          className="runner-locator-cancel"
          onClick={onCancelLocator}
          type="button"
        >
          取消
        </button>
      </div>
    </div>
  );
}
