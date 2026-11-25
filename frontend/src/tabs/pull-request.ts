/**
 * How a tab shows the pull request for its session's branch.
 *
 * The backend sends a summary (backend/pull_requests.py). A tab has room for
 * one mark, so the summary is reduced to the single thing most worth knowing,
 * the worst first: a pull request that cannot merge or is failing matters
 * more than one that is waiting on a reviewer.
 */

export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  checks: "failing" | "running" | "passing" | null;
  review: "approved" | "changes" | "required" | null;
  conflicts: boolean;
}

export type PullRequestState =
  | "conflicts"
  | "failing"
  | "changes"
  | "running"
  | "approved"
  | "passing"
  | "open";

/**
 * A mark per state as well as a colour, so the meaning does not rest on
 * colour alone.
 */
export const PR_DISPLAY: Record<PullRequestState, { mark: string; says: string }> = {
  conflicts: { mark: "≠", says: "conflicts with its base" },
  failing: { mark: "✗", says: "checks failing" },
  changes: { mark: "✎", says: "changes requested" },
  running: { mark: "…", says: "checks running" },
  approved: { mark: "✓", says: "approved" },
  passing: { mark: "", says: "checks passing" },
  open: { mark: "", says: "open" },
};

export function pullRequestState(pr: PullRequestSummary): PullRequestState {
  if (pr.conflicts) return "conflicts";
  if (pr.checks === "failing") return "failing";
  if (pr.review === "changes") return "changes";
  if (pr.checks === "running") return "running";
  if (pr.review === "approved") return "approved";
  if (pr.checks === "passing") return "passing";
  return "open";
}

/** Everything known about the pull request, for the badge's tooltip. */
export function pullRequestTitle(pr: PullRequestSummary): string {
  const facts = [
    pr.draft ? "draft" : null,
    pr.conflicts ? PR_DISPLAY.conflicts.says : null,
    pr.checks ? `checks ${pr.checks}` : null,
    pr.review === "approved"
      ? "approved"
      : pr.review === "changes"
        ? "changes requested"
        : pr.review === "required"
          ? "review required"
          : null,
  ].filter(Boolean);
  return `#${pr.number} ${pr.title}\n${facts.join(", ") || "open"}\nClick to open on GitHub`;
}
