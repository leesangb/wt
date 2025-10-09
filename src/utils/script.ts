export async function executeScript(script: string, cwd: string, env?: Record<string, string>): Promise<void> {
  await Bun.$`sh -c ${script}`.env({ ...process.env, ...env }).cwd(cwd);
}

export async function executeScripts(scripts: string[], cwd: string, env?: Record<string, string>): Promise<void> {
  for (const script of scripts) {
    await executeScript(script, cwd, env);
  }
}
