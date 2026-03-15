export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => parseInt(part, 10));
  const right = b.split(".").map((part) => parseInt(part, 10));
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
