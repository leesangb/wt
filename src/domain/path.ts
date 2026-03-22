import { posix, win32 } from "path";

function usesWindowsPaths(...paths: string[]): boolean {
  return paths.some((value) => /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\"));
}

export function isPathInside(parentPath: string, childPath: string): boolean {
  const pathApi = usesWindowsPaths(parentPath, childPath) ? win32 : posix;
  const relPath = pathApi.relative(parentPath, childPath);

  return (
    relPath === "" ||
    (
      !pathApi.isAbsolute(relPath) &&
      !relPath.startsWith("..") &&
      relPath !== ".." &&
      !relPath.startsWith("../") &&
      !relPath.startsWith("..\\")
    )
  );
}
