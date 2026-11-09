export function normalizePathForComparison(value) {
  const input = String(value).replace(/\\/g, "/");
  const drive = /^([A-Za-z]:)\//.exec(input)?.[1] ?? "";
  const unc = input.startsWith("//");
  const absolute = Boolean(drive) || unc || input.startsWith("/");
  const segments = [];
  for (const segment of input.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments.at(-1) !== "..") {
        segments.pop();
      } else if (!absolute) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }
  const prefix = unc ? "//" : drive ? `${drive}/` : absolute ? "/" : "";
  const normalized = `${prefix}${segments.join("/")}` || prefix || ".";
  return drive || unc ? normalized.toLowerCase() : normalized;
}

export function isInsideRoot(targetPath, rootPath) {
  const target = normalizePathForComparison(targetPath);
  const root = normalizePathForComparison(rootPath);
  return target === root || target.startsWith(`${root.replace(/\/+$/, "")}/`);
}

export function assertInsideRoot(
  targetPath,
  rootPath,
  message = `路径不在工程内：${targetPath}`,
) {
  if (!isInsideRoot(targetPath, rootPath)) {
    throw new Error(message);
  }
  return targetPath;
}
