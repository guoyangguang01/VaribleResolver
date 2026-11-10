import type {
  LaunchLocator,
  LocatorDetail,
  LocatorEditorState,
} from "./locators/model.ts";
import { locatorStrategyForKind } from "./locators/registry.ts";

export function locatorEditorState(
  locator: LaunchLocator,
): LocatorEditorState {
  return locatorStrategyForKind(locator.kind).toEditorState(locator);
}

export function locatorDetails(locator: LaunchLocator): LocatorDetail[] {
  return locatorStrategyForKind(locator.kind).details(locator);
}

export function locatorSummary(locator: LaunchLocator): string {
  return locatorStrategyForKind(locator.kind).summary(locator);
}
