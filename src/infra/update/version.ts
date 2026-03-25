function parseVersion(version: string): number[] {
  if (!/^\d+(?:\.\d+)*$/.test(version)) {
    throw new Error(`Invalid version format: ${version}`);
  }

  return version.split(".").map((part) => parseInt(part, 10));
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index++) {
    const leftPart = left[index] || 0;
    const rightPart = right[index] || 0;

    if (leftPart > rightPart) {
      return 1;
    }

    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}
