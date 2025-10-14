export async function executeScript(script: string, cwd: string, env?: Record<string, string>): Promise<void> {
  const proc = Bun.spawn(['sh', '-c', script], {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Script exited with code ${exitCode}`);
  }
}

export async function executeScripts(scripts: string[], cwd: string, env?: Record<string, string>): Promise<void> {
  for (const script of scripts) {
    await executeScript(script, cwd, env);
  }
}
