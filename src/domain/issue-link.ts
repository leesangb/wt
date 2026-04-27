import type { WtIssueSettings } from "./settings.js";

export interface IssueLink {
  key: string;
  url: string;
}

export function buildIssueLink(
  branch: string | undefined,
  settings: WtIssueSettings | undefined
): IssueLink | undefined {
  if (!branch || !settings) {
    return undefined;
  }

  return buildIssueLinkFromPattern(
    branch,
    new RegExp(settings.pattern),
    settings.url
  );
}

export function buildIssueLinkFromPattern(
  branch: string | undefined,
  pattern: RegExp,
  urlTemplate: string
): IssueLink | undefined {
  if (!branch) {
    return undefined;
  }

  const match = pattern.exec(branch);

  if (!match) {
    return undefined;
  }

  const issueKey = match[1] ?? match[0];

  if (!issueKey) {
    return undefined;
  }

  return {
    key: issueKey,
    url: urlTemplate.replaceAll("$issue", encodeURIComponent(issueKey)),
  };
}
