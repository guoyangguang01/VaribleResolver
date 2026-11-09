import type {
  ProjectProgramRequest,
  ProjectProgramResult,
} from "../src/lib/projectExecution";

export function runProgram(
  request: ProjectProgramRequest,
): Promise<ProjectProgramResult>;
