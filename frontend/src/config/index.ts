export { config } from "./config";
export {
  getUserConfig,
  setUserConfig,
  matchesKeybinding,
  parseKeybinding,
  type UserConfig,
  type KeybindingsConfig,
} from "./user-config";
export { applySavedTheme, applyTheme, onThemeChange, themes, getSavedThemeId } from "./themes";
