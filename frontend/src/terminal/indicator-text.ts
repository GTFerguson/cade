/**
 * What the corner label says. The agent's own terminal is where a tab
 * normally is, and the tab already says which agent it runs, so that view
 * is left unlabelled; the label is for being somewhere else (the shell, the
 * chat).
 */
export function indicatorText(label: string, agentLabel: string): string {
  return label === `[${agentLabel}]` ? "" : label;
}
