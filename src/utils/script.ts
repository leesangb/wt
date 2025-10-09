import { execa } from "execa";

export async function executeScript(script: string, cwd: string, env?: Record<string, string>): Promise<void> {
  await execa("sh", ["-c", script], {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

export async function executeScripts(scripts: string[], cwd: string, env?: Record<string, string>): Promise<void> {
  for (const script of scripts) {
    await executeScript(script, cwd, env);
  }
}
