/**
 * Mermaid theme matching CADE's dark IDE palette, shared by every surface
 * that renders diagrams (chat and the file viewer) so they look the same.
 */

export const CADE_MERMAID_CONFIG = {
  securityLevel: "loose" as const,
  theme: "base" as const,
  themeVariables: {
    darkMode: true,
    background: "#111110",
    primaryColor: "#1a1918",
    primaryTextColor: "#f8f6f2",
    primaryBorderColor: "#0a9dff",
    secondaryColor: "#1a1918",
    secondaryTextColor: "#c4b9ad",
    secondaryBorderColor: "#aeee00",
    tertiaryColor: "#1a1918",
    tertiaryBorderColor: "#ff9eb0",
    lineColor: "#0a9dff",
    textColor: "#c4b9ad",
    mainBkg: "#1a1918",
    nodeBorder: "#0a9dff",
    clusterBkg: "#111110",
    clusterBorder: "#0a9dff",
    titleColor: "#f8f6f2",
    edgeLabelBackground: "#111110",
    nodeTextColor: "#f8f6f2",
    git0: "#0a9dff",
    git1: "#aeee00",
    git2: "#ff9eb0",
    git3: "#ffa724",
    git4: "#cf73e6",
    git5: "#0a9dff",
    git6: "#aeee00",
    git7: "#ff9eb0",
    gitBranchLabel0: "#f8f6f2",
    gitBranchLabel1: "#f8f6f2",
    gitBranchLabel2: "#f8f6f2",
    gitBranchLabel3: "#f8f6f2",
    gitInv0: "#0a9dff",
  },
};
