import { AppError } from "../app/errors.js";
import { listOpenPullRequestsForCompletion } from "../app/use-cases/list-open-pull-requests.js";
import { runCommand } from "../cli/command-runtime.js";

type CompletionFormat = "bash" | "zsh" | "fish";

const COMPLETION_FORMATS = new Set<CompletionFormat>(["bash", "zsh", "fish"]);

function sanitizeDescription(value: string): string {
  return value.replaceAll(/[\r\n\t:]+/g, " ").replaceAll(/\s+/g, " ").trim();
}

export async function completePrCommand(format: string): Promise<void> {
  await runCommand(async () => {
    if (!COMPLETION_FORMATS.has(format as CompletionFormat)) {
      throw new AppError(
        `Unsupported completion format "${format}". Expected one of: bash, zsh, fish.`
      );
    }

    const pullRequests = await listOpenPullRequestsForCompletion();

    for (const pullRequest of pullRequests) {
      const metadata = [
        pullRequest.isDraft ? "Draft" : undefined,
        sanitizeDescription(pullRequest.title),
        `@${sanitizeDescription(pullRequest.author)}`,
        sanitizeDescription(pullRequest.headRefName),
      ].filter((value): value is string => Boolean(value));
      const separator = format === "fish" ? "\t" : ":";

      console.log(`${pullRequest.number}${separator}${metadata.join(" | ")}`);
    }
  });
}
