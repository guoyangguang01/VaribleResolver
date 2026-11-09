import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

export interface WorkbenchLayout {
  leftWidth: number;
  rightWidth: number;
  dockHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  dockCollapsed: boolean;
}

const LAYOUT_STORAGE_KEY = "program-studio-workbench-layout-v2";

export const DEFAULT_LAYOUT: WorkbenchLayout = {
  leftWidth: 232,
  rightWidth: 320,
  dockHeight: 180,
  leftCollapsed: false,
  rightCollapsed: false,
  dockCollapsed: true,
};

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function readWorkbenchLayout(): WorkbenchLayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "null",
    ) as Partial<WorkbenchLayout> | null;
    if (!stored) return DEFAULT_LAYOUT;
    return {
      leftWidth: clampNumber(stored.leftWidth, 200, 360, 232),
      rightWidth: clampNumber(stored.rightWidth, 280, 460, 320),
      dockHeight: clampNumber(stored.dockHeight, 180, 480, 260),
      leftCollapsed: Boolean(stored.leftCollapsed),
      rightCollapsed: Boolean(stored.rightCollapsed),
      dockCollapsed: Boolean(stored.dockCollapsed),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function useWorkbenchLayout() {
  const [layout, setLayout] = useState<WorkbenchLayout>(readWorkbenchLayout);

  useEffect(() => {
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify(layout),
    );
  }, [layout]);

  const beginResize = (
    target: "left" | "right" | "dock",
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = layout;
    document.body.classList.add("is-resizing");

    const handleMove = (moveEvent: PointerEvent) => {
      if (target === "left") {
        setLayout((current) => ({
          ...current,
          leftWidth: Math.min(
            360,
            Math.max(200, initial.leftWidth + moveEvent.clientX - startX),
          ),
        }));
      } else if (target === "right") {
        setLayout((current) => ({
          ...current,
          rightWidth: Math.min(
            460,
            Math.max(280, initial.rightWidth - moveEvent.clientX + startX),
          ),
        }));
      } else {
        setLayout((current) => ({
          ...current,
          dockHeight: Math.min(
            480,
            Math.max(180, initial.dockHeight - moveEvent.clientY + startY),
          ),
        }));
      }
    };

    const handleUp = () => {
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const resizeWithKeyboard = (
    target: "left" | "right" | "dock",
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    const delta = 16;
    if (target === "left") {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setLayout((current) => ({
        ...current,
        leftWidth: Math.min(
          360,
          Math.max(
            200,
            current.leftWidth + (event.key === "ArrowRight" ? delta : -delta),
          ),
        ),
      }));
      return;
    }
    if (target === "right") {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setLayout((current) => ({
        ...current,
        rightWidth: Math.min(
          460,
          Math.max(
            280,
            current.rightWidth + (event.key === "ArrowLeft" ? delta : -delta),
          ),
        ),
      }));
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    setLayout((current) => ({
      ...current,
      dockHeight: Math.min(
        480,
        Math.max(
          180,
          current.dockHeight + (event.key === "ArrowUp" ? delta : -delta),
        ),
      ),
    }));
  };

  return { layout, setLayout, beginResize, resizeWithKeyboard };
}
