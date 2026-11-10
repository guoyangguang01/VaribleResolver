export type SourceLineEnding = "\n" | "\r\n" | "\r";

export function normalizeSourceText(source: string): string {
  return source.replace(/\r\n?/g, "\n");
}

export function detectSourceLineEnding(source: string): SourceLineEnding {
  const lineEnding = /\r\n|\r|\n/.exec(source)?.[0];
  return lineEnding === "\r\n" || lineEnding === "\r" ? lineEnding : "\n";
}

export function restoreSourceLineEndings(
  source: string,
  lineEnding: SourceLineEnding,
): string {
  return lineEnding === "\n" ? source : source.replace(/\n/g, lineEnding);
}

export interface SourceRange {
  start: number;
  end: number;
}
