import type {
  FileLaunchBinding,
  LaunchLocatorMode,
  LocatorModeValues,
} from "../../../lib/launcher";

export interface LocatorFieldProps {
  values: LocatorModeValues;
  updateLocatorValue: <K extends keyof LocatorModeValues>(
    key: K,
    value: LocatorModeValues[K],
  ) => void;
}

export interface LocatorEditorProps {
  editingBinding: FileLaunchBinding | null;
  locatorMode: LaunchLocatorMode;
  locatorModeValues: LocatorModeValues;
  onApplyLocator: () => void;
  onCancelLocator: () => void;
  setLocatorMode: (mode: LaunchLocatorMode) => void;
  updateLocatorValue: LocatorFieldProps["updateLocatorValue"];
}
