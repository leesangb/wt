export const SUPPORTED_SHELLS = ["bash", "zsh", "fish"] as const;

export type SupportedShell = (typeof SUPPORTED_SHELLS)[number];

export function isSupportedShell(value: string): value is SupportedShell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(value);
}
