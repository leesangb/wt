const CONVENTIONAL_PREFIX =
  /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([^)]*\))?!?:\s*/i;

function compileIssuePattern(pattern: string | undefined): RegExp | undefined {
  if (!pattern) {
    return undefined;
  }

  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

function stripLeadingIssue(
  title: string,
  issuePattern: RegExp | undefined
): string | undefined {
  if (!issuePattern) {
    return undefined;
  }

  const match = issuePattern.exec(title);

  if (!match?.[0] || match.index !== 0) {
    return undefined;
  }

  return title.slice(match[0].length).replace(/^[\s:–—-]+/, "");
}

export function buildPullRequestLabel(
  author: string,
  title: string,
  issuePattern?: string
): string {
  const originalTitle = title.trim();
  const compiledIssuePattern = compileIssuePattern(issuePattern);
  let trimmedTitle = originalTitle;

  while (trimmedTitle) {
    const withoutConventionalPrefix = trimmedTitle.replace(
      CONVENTIONAL_PREFIX,
      ""
    );

    if (withoutConventionalPrefix !== trimmedTitle) {
      trimmedTitle = withoutConventionalPrefix;
      continue;
    }

    const withoutIssue = stripLeadingIssue(trimmedTitle, compiledIssuePattern);

    if (withoutIssue === undefined) {
      break;
    }

    trimmedTitle = withoutIssue;
  }

  return `${author}: ${trimmedTitle || originalTitle}`;
}
