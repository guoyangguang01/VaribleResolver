/// <reference types="vite/client" />

interface DesktopFilePayload {
  path: string;
  name: string;
  content: string;
  size: number;
  modifiedAt: number;
}

interface DesktopRunResult {
  status: "completed" | "failed";
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface ProgramStudioApi {
  isDesktop: true;
  selectFiles: () => Promise<DesktopFilePayload[]>;
  readFiles: (filePaths: string[]) => Promise<DesktopFilePayload[]>;
  writeFiles: (
    files: Array<{ path: string; content: string }>,
  ) => Promise<string[]>;
  updateFiles: (
    files: Array<{ path: string; content: string }>,
  ) => Promise<string[]>;
  saveProject: (
    payload: unknown,
    options?: {
      mode?: "save" | "saveAs";
      path?: string;
    },
  ) => Promise<{ path: string; name: string } | null>;
  openProject: () => Promise<unknown | null>;
  openDefaultProject: () => Promise<unknown>;
  createRunWorkspace: (
    projectPath: string,
  ) => Promise<{ runId: string; path: string }>;
  runProgram: (request: {
    mode?: "direct" | "shell";
    program: string;
    args: string[];
    cwd?: string;
    environment?: Record<string, string>;
  }) => Promise<DesktopRunResult>;
  setDirty: (dirty: boolean) => void;
  setTheme: (preference: "system" | "light" | "dark") => void;
}

interface Window {
  programStudio?: ProgramStudioApi;
}
