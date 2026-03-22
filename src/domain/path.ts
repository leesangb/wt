import { relative } from "path";

export function isPathInside(parentPath: string, childPath: string): boolean {
  const relPath = relative(parentPath, childPath);

  return (
    relPath === "" ||
    (!relPath.startsWith("..") && relPath !== ".." && !relPath.startsWith("../"))
  );
}
