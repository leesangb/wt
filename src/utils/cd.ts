import { writeFileSync } from "fs";

export const SHELL_CD_FILE_ENV = "WT_SHELL_CD_FILE";

export function emitShellCd(path: string): void {
  const shellCdFile = process.env[SHELL_CD_FILE_ENV];

  if (shellCdFile) {
    writeFileSync(shellCdFile, `${path}\n`, "utf-8");
    return;
  }

  console.log(`cd ${path}`);
}
