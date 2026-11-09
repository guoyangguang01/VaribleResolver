export function normalizePathForComparison(value: string): string;
export function isInsideRoot(targetPath: string, rootPath: string): boolean;
export function assertInsideRoot(
  targetPath: string,
  rootPath: string,
  message?: string,
): string;
