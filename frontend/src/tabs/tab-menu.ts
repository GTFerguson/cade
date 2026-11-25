/**
 * The small menu a right-click on a tab or a group chip opens.
 */

export interface MenuAction {
  kind: "action";
  label: string;
  action: () => void;
  /** Marks the entry that is already in effect. */
  checked?: boolean;
}

export interface MenuHeading {
  kind: "heading";
  label: string;
}

export interface MenuSeparator {
  kind: "separator";
}

/** A row of colour choices, shown as swatches rather than a list of names. */
export interface MenuSwatches {
  kind: "swatches";
  label: string;
  options: { value: string; css: string }[];
  selected: string;
  onPick: (value: string) => void;
}

export type MenuEntry = MenuAction | MenuHeading | MenuSeparator | MenuSwatches;

/** Gap kept between the menu and the window edge. */
const EDGE_MARGIN_PX = 4;

let closeOpenMenu: (() => void) | null = null;

/**
 * Open a menu at a point in the window. Only one is open at a time. Returns
 * the function that closes it.
 */
export function openTabMenu(x: number, y: number, entries: MenuEntry[]): () => void {
  closeOpenMenu?.();

  // Focus goes back where it was (usually the terminal) once the menu closes.
  const focusBefore = document.activeElement as HTMLElement | null;

  const menu = document.createElement("div");
  menu.className = "tab-menu";
  menu.setAttribute("role", "menu");

  const buttons: HTMLButtonElement[] = [];

  const close = () => {
    if (closeOpenMenu !== close) return;
    closeOpenMenu = null;
    menu.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("blur", close);
    window.removeEventListener("resize", close);
    if (focusBefore?.isConnected && !document.activeElement?.closest("input, textarea")) {
      focusBefore.focus();
    }
  };

  const run = (action: () => void) => {
    close();
    action();
  };

  for (const entry of entries) {
    if (entry.kind === "separator") {
      const rule = document.createElement("div");
      rule.className = "tab-menu-separator";
      menu.appendChild(rule);
    } else if (entry.kind === "heading") {
      const heading = document.createElement("div");
      heading.className = "tab-menu-heading";
      heading.textContent = entry.label;
      menu.appendChild(heading);
    } else if (entry.kind === "swatches") {
      const row = document.createElement("div");
      row.className = "tab-menu-swatches";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", entry.label);
      for (const option of entry.options) {
        const swatch = document.createElement("button");
        swatch.className = "tab-menu-swatch";
        swatch.style.setProperty("--swatch", option.css);
        swatch.title = option.value;
        swatch.setAttribute("aria-label", option.value);
        swatch.setAttribute("aria-pressed", String(option.value === entry.selected));
        swatch.addEventListener("click", () => run(() => entry.onPick(option.value)));
        row.appendChild(swatch);
      }
      menu.appendChild(row);
    } else {
      const item = document.createElement("button");
      item.className = "tab-menu-item";
      item.setAttribute("role", "menuitem");
      item.textContent = entry.label;
      if (entry.checked) item.dataset["checked"] = "true";
      item.addEventListener("click", () => run(entry.action));
      buttons.push(item);
      menu.appendChild(item);
    }
  }

  const onPointerDown = (e: Event) => {
    if (!menu.contains(e.target as Node)) close();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // The menu owns the keyboard while open: nothing typed here should reach
    // the terminal or trigger an app shortcut.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (buttons.length === 0) return;
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = at === -1 ? (step === 1 ? 0 : buttons.length - 1) : (at + step + buttons.length) % buttons.length;
      buttons[next]!.focus();
    }
  };

  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const left = Math.max(EDGE_MARGIN_PX, Math.min(x, window.innerWidth - rect.width - EDGE_MARGIN_PX));
  const top = Math.max(EDGE_MARGIN_PX, Math.min(y, window.innerHeight - rect.height - EDGE_MARGIN_PX));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", close);
  window.addEventListener("resize", close);

  closeOpenMenu = close;
  buttons[0]?.focus();
  return close;
}
