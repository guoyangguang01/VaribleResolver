/// <reference types="vite/client" />

interface DesktopFilePayload {
  path: string;
  name: string;
  content: string;
  size: number;
  modifiedAt: number;
}

interface DesktopRunResult {
  status: "completed" | "failed" | "timeout";
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
  saveProject: (
    payload: unknown,
  ) => Promise<{ path: string; name: string } | null>;
  openProject: () => Promise<unknown | null>;
  runProgram: (request: {
    program: string;
    args: string[];
    cwd?: string;
    timeoutMs?: number;
  }) => Promise<DesktopRunResult>;
}

interface Window {
  programStudio?: ProgramStudioApi;
}
