/**
 * Mermaid theme built from the active CADE theme, shared by every surface
 * that renders diagrams (chat and the file viewer) so they look the same.
 */

import { getActiveTheme } from "../config/themes";

export type CadeMermaidConfig = ReturnType<typeof getMermaidConfig>;

export function getMermaidConfig() {
  const { mode, colors: c } = getActiveTheme();
  // Pink sits outside the light accent set, so dark themes keep the
  // original badwolf tone while light themes reuse the rose accent.
  const pink = mode === "light" ? c.accentPurple : "#ff9eb0";
  const violet = mode === "light" ? "#7247a6" : "#cf73e6";
  // Branch labels sit on accent-filled pills: bright accents (dark themes)
  // need dark-on-light text, deep accents (light themes) need the reverse.
  const branchLabel = mode === "light" ? c.bgPrimary : c.textPrimary;
  return {
    securityLevel: "loose" as const,
    theme: "base" as const,
    themeVariables: {
      darkMode: mode === "dark",
      background: c.bgSecondary,
      primaryColor: c.bgTertiary,
      primaryTextColor: c.textPrimary,
      primaryBorderColor: c.accentBlue,
      secondaryColor: c.bgTertiary,
      secondaryTextColor: c.textSecondary,
      secondaryBorderColor: c.accentGreen,
      tertiaryColor: c.bgTertiary,
      tertiaryBorderColor: pink,
      lineColor: c.accentBlue,
      textColor: c.textSecondary,
      mainBkg: c.bgTertiary,
      nodeBorder: c.accentBlue,
      clusterBkg: c.bgSecondary,
      clusterBorder: c.accentBlue,
      titleColor: c.textPrimary,
      edgeLabelBackground: c.bgSecondary,
      nodeTextColor: c.textPrimary,
      git0: c.accentBlue,
      git1: c.accentGreen,
      git2: pink,
      git3: c.accentOrange,
      git4: violet,
      git5: c.accentBlue,
      git6: c.accentGreen,
      git7: pink,
      gitBranchLabel0: branchLabel,
      gitBranchLabel1: branchLabel,
      gitBranchLabel2: branchLabel,
      gitBranchLabel3: branchLabel,
      gitInv0: c.accentBlue,
    },
  };
}
