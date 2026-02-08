/**
 * Scramble animation effects for the CADE splash screen.
 *
 * Extracted from plans/scramble-lab.html. Each effect operates on a
 * <pre> element, mutating its textContent frame-by-frame through
 * character-phase transitions (binary → glitch → final, or reverse).
 *
 * Two categories:
 *  - Load-in: empty → logo (used when splash appears)
 *  - Dismiss: logo → empty (used when splash hides)
 */

// ─── Character sets ─────────────────────────────────────────────────

const CH = {
  binary: "01",
  blocks: "█▓▒░▀▄▌▐",
  brailleSparse: "⠁⠂⠄⠈⠐⠠⡀⢀",
  braille: "⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⡀⡁⣀⣁⣠⣡⣿",
  brailleDense: "⠿⡿⣿⣷⣾⣻⣽⣯⣟",
  ghostFaint: '·.,:"',
  ghostMed: "░;|¦†‖",
  dots: '·.,:"',
};

const GLITCH = "█▓▒░▀▄▌▐◼◻";

function rc(set: string): string {
  return set[Math.floor(Math.random() * set.length)]!;
}

// ─── Logo text constants ────────────────────────────────────────────

/** Desktop logo — block characters (existing) */
export const CADE_LOGO = `   █████████    █████████   ██████████   ██████████
  ███░░░░░███  ███░░░░░███ ░░███░░░░███ ░░███░░░░░█
 ███     ░░░  ░███    ░███  ░███   ░░███ ░███  █ ░
░███          ░███████████  ░███    ░███ ░██████
░███          ░███░░░░░███  ░███    ░███ ░███░░█
░░███     ███ ░███    ░███  ░███    ███  ░███ ░   █
 ░░█████████  █████   █████ ██████████   ██████████
  ░░░░░░░░░  ░░░░░   ░░░░░ ░░░░░░░░░░   ░░░░░░░░░░`;

/** Mobile logo — box-drawing characters (narrower, monospace-safe) */
export const CADE_LOGO_MOBILE = ` ██████╗ █████╗ ██████╗ ███████╗
██╔════╝██╔══██╗██╔══██╗██╔════╝
██║     ███████║██║  ██║█████╗
██║     ██╔══██║██║  ██║██╔══╝
╚██████╗██║  ██║██████╔╝███████╗
 ╚═════╝╚═╝  ╚═╝╚═════╝ ╚══════╝`;

// ─── Grid helpers ───────────────────────────────────────────────────

interface Pos {
  r: number;
  c: number;
}

function vis(ch: string): boolean {
  return ch !== " " && ch !== "\n";
}

function visPos(lines: string[]): Pos[] {
  const p: Pos[] = [];
  for (let r = 0; r < lines.length; r++) {
    for (let c = 0; c < lines[r]!.length; c++) {
      if (vis(lines[r]![c]!)) p.push({ r, c });
    }
  }
  return p;
}

function toGrid(lines: string[]): string[][] {
  return lines.map((l) => l.split(""));
}

function gridStr(g: string[][]): string {
  return g.map((r) => r.join("")).join("\n");
}

function emptyGrid(lines: string[]): string[][] {
  return lines.map((l) => l.split("").map((ch) => (vis(ch) ? " " : ch)));
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const PHASE_CLASSES = ["phase-binary", "phase-blocks", "phase-final", "phase-dying"];

/** Set phase class without losing other classes (e.g. splash-logo-mobile) */
function setPhase(el: HTMLElement, phase: string): void {
  el.classList.remove(...PHASE_CLASSES);
  el.classList.add(phase);
}

// ─── Public types ───────────────────────────────────────────────────

export type SplashEffect =
  | "binaryBootSlow"
  | "binaryEntropySmooth"
  | "brailleBoot"
  | "ghostBoot"
  | "brailleEntropy"
  | "ghostEntropy"
  | "binaryEntropyCollapse";

type EffectFn = (
  el: HTMLElement,
  logo: string,
  done: () => void
) => void;

// ─── Effect registry ────────────────────────────────────────────────

const effects: Record<SplashEffect, EffectFn> = {
  binaryBootSlow,
  binaryEntropySmooth,
  brailleBoot,
  ghostBoot,
  brailleEntropy,
  ghostEntropy,
  binaryEntropyCollapse,
};

/**
 * Run a load-in effect on the given element.
 * Clears the element first, then animates the logo into view.
 */
export function runLoadIn(
  el: HTMLElement,
  logo: string,
  effect: SplashEffect,
  done: () => void
): void {
  el.textContent = "";
  effects[effect](el, logo, done);
}

/**
 * Run a dismiss effect on the given element.
 * Assumes the element currently shows the logo text.
 */
export function runDismiss(
  el: HTMLElement,
  logo: string,
  effect: SplashEffect,
  done: () => void
): void {
  effects[effect](el, logo, done);
}

// ─── Load-in effects ────────────────────────────────────────────────

/**
 * Binary Boot Slow: binary chars appear with ease-in acceleration,
 * glitch creep kicks in at ~30%, LTR resolve sweep from ~45%.
 */
function binaryBootSlow(
  el: HTMLElement,
  logo: string,
  done: () => void
): void {
  const lines = logo.split("\n");
  const current = emptyGrid(lines);
  const positions = shuffle(visPos(lines).slice());
  const goalGrid = toGrid(lines);
  const total = positions.length;
  const maxCol = Math.max(...lines.map((l) => l.length));

  el.textContent = gridStr(current);
  setPhase(el, "phase-binary");

  const totalFrames = 32;
  let frame = 0;
  let placed = 0;

  const iv = window.setInterval(() => {
    frame++;
    const p = frame / totalFrames;

    // Accelerating binary fill (ease-in to 100% by p=0.50)
    const fillTarget = Math.min(
      total,
      Math.floor(total * Math.pow(Math.min(p / 0.5, 1), 2.2))
    );
    while (placed < fillTarget) {
      const { r, c } = positions[placed]!;
      current[r]![c] = rc(CH.binary);
      placed++;
    }

    // Update placed chars: resolve sweep + glitch creep
    for (let i = 0; i < placed; i++) {
      const { r, c } = positions[i]!;

      if (p > 0.45) {
        const sweepP = (p - 0.45) / 0.55;
        const charPos = c / maxCol;
        if (sweepP > charPos + 0.15) {
          current[r]![c] = goalGrid[r]![c]!;
          continue;
        }
        current[r]![c] = GLITCH[Math.floor(Math.random() * GLITCH.length)]!;
        continue;
      }

      if (p > 0.3) {
        const glitchIntensity = (p - 0.3) / 0.15;
        if (Math.random() < glitchIntensity * 0.5) {
          current[r]![c] = GLITCH[Math.floor(Math.random() * GLITCH.length)]!;
          continue;
        }
      }

      if (Math.random() < 0.04) current[r]![c] = rc(CH.binary);
    }

    // Color phase
    if (p > 0.65) setPhase(el, "phase-final");
    else if (p > 0.3) setPhase(el, "phase-blocks");
    else setPhase(el, "phase-binary");

    el.textContent = gridStr(current);

    if (frame >= totalFrames) {
      clearInterval(iv);
      el.textContent = logo;
      setPhase(el, "phase-final");
      done();
    }
  }, 40);
}

/**
 * Braille Boot: sparse braille dots densify into the logo.
 */
function brailleBoot(
  el: HTMLElement,
  logo: string,
  done: () => void
): void {
  const lines = logo.split("\n");
  const current = emptyGrid(lines);
  const positions = shuffle(visPos(lines).slice());
  const goalGrid = toGrid(lines);
  const total = positions.length;

  el.textContent = gridStr(current);
  el.classList.remove(...PHASE_CLASSES);

  let placed = 0;
  let frame = 0;

  function fillPhase(): void {
    frame++;
    const speed = Math.max(1, Math.floor(Math.pow(frame / 6, 1.6)));
    const batchEnd = Math.min(placed + speed, total);

    for (let i = placed; i < batchEnd; i++) {
      const { r, c } = positions[i]!;
      current[r]![c] = rc(CH.brailleSparse);
    }
    placed = batchEnd;

    if (frame % 2 === 0) {
      for (let i = 0; i < placed; i++) {
        if (Math.random() < 0.05) {
          const { r, c } = positions[i]!;
          current[r]![c] = rc(CH.braille);
        }
      }
    }

    el.textContent = gridStr(current);

    if (placed >= total) {
      setTimeout(densifyPhase, 100);
    } else {
      requestAnimationFrame(fillPhase);
    }
  }

  function densifyPhase(): void {
    const totalFrames = 22;
    let f = 0;
    const pos = visPos(lines);

    const iv = window.setInterval(() => {
      f++;
      const p = f / totalFrames;

      for (const { r, c } of pos) {
        const jitter = Math.random() * 0.15;
        if (p + jitter > 0.7) {
          current[r]![c] = goalGrid[r]![c]!;
        } else if (p + jitter > 0.4) {
          current[r]![c] = rc(CH.brailleDense);
        } else {
          current[r]![c] = rc(CH.braille);
        }
      }

      el.textContent = gridStr(current);

      if (f >= totalFrames) {
        clearInterval(iv);
        el.textContent = logo;
        setPhase(el, "phase-final");
        done();
      }
    }, 32);
  }

  fillPhase();
}

/**
 * Ghost Boot: faint punctuation solidifies through density phases.
 */
function ghostBoot(
  el: HTMLElement,
  logo: string,
  done: () => void
): void {
  const lines = logo.split("\n");
  const current = emptyGrid(lines);
  const positions = shuffle(visPos(lines).slice());
  const goalGrid = toGrid(lines);
  const total = positions.length;

  el.textContent = gridStr(current);
  setPhase(el, "phase-dying");

  let placed = 0;
  let frame = 0;

  function fillPhase(): void {
    frame++;
    const speed = Math.max(1, Math.floor(Math.pow(frame / 7, 1.7)));
    const batchEnd = Math.min(placed + speed, total);

    for (let i = placed; i < batchEnd; i++) {
      const { r, c } = positions[i]!;
      current[r]![c] = rc(CH.ghostFaint);
    }
    placed = batchEnd;

    el.textContent = gridStr(current);

    if (placed >= total) {
      setTimeout(solidifyPhase, 100);
    } else {
      requestAnimationFrame(fillPhase);
    }
  }

  function solidifyPhase(): void {
    const phases = [CH.ghostFaint, CH.ghostMed, "░▒", "▒▓", "▓█"];
    const totalFrames = 28;
    let f = 0;
    const pos = visPos(lines);

    const iv = window.setInterval(() => {
      f++;
      const p = f / totalFrames;

      if (p > 0.6) setPhase(el, "phase-final");
      else if (p > 0.35) setPhase(el, "phase-blocks");
      else setPhase(el, "phase-dying");

      for (const { r, c } of pos) {
        const jitter = Math.random() * 0.12;
        const lp = p + jitter;

        if (lp > 0.8) {
          current[r]![c] = goalGrid[r]![c]!;
        } else {
          const phaseIdx = Math.min(
            Math.floor(lp * phases.length),
            phases.length - 1
          );
          current[r]![c] = rc(phases[phaseIdx]!);
        }
      }

      el.textContent = gridStr(current);

      if (f >= totalFrames) {
        clearInterval(iv);
        el.textContent = logo;
        setPhase(el, "phase-final");
        done();
      }
    }, 35);
  }

  fillPhase();
}

// ─── Dismiss effects ────────────────────────────────────────────────

/**
 * Binary Entropy Smooth: each char independently degrades through
 * glitch phases at random speed, then vanishes.
 */
function binaryEntropySmooth(
  el: HTMLElement,
  logo: string,
  done: () => void
): void {
  const lines = logo.split("\n");
  const current = toGrid(lines);
  const goalGrid = toGrid(lines);
  const positions = visPos(lines);
  const totalFrames = 48;
  let frame = 0;

  const deathSpeed: Record<string, number> = {};
  for (const { r, c } of positions) {
    deathSpeed[`${r},${c}`] = 0.3 + Math.random() * 0.7;
  }

  setPhase(el, "phase-final");

  const iv = window.setInterval(() => {
    frame++;
    const p = frame / totalFrames;

    if (p > 0.6) setPhase(el, "phase-dying");
    else if (p > 0.15) setPhase(el, "phase-blocks");

    for (const { r, c } of positions) {
      const ds = deathSpeed[`${r},${c}`]!;
      const lp = p / ds;

      if (lp > 1.0) {
        current[r]![c] = " ";
      } else if (lp > 0.8) {
        current[r]![c] =
          Math.random() < 0.25
            ? GLITCH[Math.floor(Math.random() * GLITCH.length)]!
            : " ";
      } else if (lp > 0.5) {
        current[r]![c] =
          Math.random() < 0.4
            ? rc(CH.binary)
            : GLITCH[Math.floor(Math.random() * GLITCH.length)]!;
      } else if (lp > 0.2) {
        current[r]![c] = GLITCH[Math.floor(Math.random() * GLITCH.length)]!;
      } else {
        current[r]![c] =
          Math.random() < p * 0.6
            ? GLITCH[Math.floor(Math.random() * GLITCH.length)]!
            : goalGrid[r]![c]!;
      }
    }

    el.textContent = gridStr(current);

    if (frame >= totalFrames) {
      clearInterval(iv);
      setPhase(el, "phase-dying");
      done();
    }
  }, 35);
}

/**
 * Binary Entropy Collapse: edges corrupt first, chaos crushes inward
 * to the center.
 */
function binaryEntropyCollapse(
  el: HTMLElement,
  logo: string,
  done: () => void
): void {
  const lines = logo.split("\n");
  const current = toGrid(lines);
  const goalGrid = toGrid(lines);
  const positions = visPos(lines);
  const maxCol = Math.max(...lines.map((l) => l.length));
  const centerR = lines.length / 2;
  const centerC = maxCol / 2;
  const maxDist = Math.sqrt(centerR * centerR + (centerC * 0.5) ** 2);
  const totalFrames = 45;
  let frame = 0;

  setPhase(el, "phase-final");

  const iv = window.setInterval(() => {
    frame++;
    const p = frame / totalFrames;
    const killRadius = maxDist * (1 - p) * 1.1;

    for (const { r, c } of positions) {
      const dist = Math.sqrt(
        (r - centerR) ** 2 + ((c - centerC) * 0.45) ** 2
      );

      if (dist > killRadius + 4) {
        current[r]![c] = " ";
      } else if (dist > killRadius + 2) {
        current[r]![c] =
          Math.random() < 0.2
            ? GLITCH[Math.floor(Math.random() * GLITCH.length)]!
            : " ";
      } else if (dist > killRadius - 1) {
        current[r]![c] =
          Math.random() < 0.5
            ? rc(CH.binary)
            : GLITCH[Math.floor(Math.random() * GLITCH.length)]!;
      } else if (dist > killRadius - 5) {
        current[r]![c] = GLITCH[Math.floor(Math.random() * GLITCH.length)]!;
      } else {
        current[r]![c] =
          Math.random() < p * 0.3
            ? GLITCH[Math.floor(Math.random() * GLITCH.length)]!
            : goalGrid[r]![c]!;
      }
    }

    if (p > 0.7) setPhase(el, "phase-dying");
    else if (p > 0.2) setPhase(el, "phase-blocks");

    el.textContent = gridStr(current);

    if (frame >= totalFrames) {
      clearInterval(iv);
      setPhase(el, "phase-dying");
      done();
    }
  }, 30);
}

/**
 * Braille Entropy: logo crumbles into sparse braille dust.
 */
function brailleEntropy(
  el: HTMLElement,
  logo: string,
  done: () => void
): void {
  const lines = logo.split("\n");
  const current = toGrid(lines);
  const goalGrid = toGrid(lines);
  const positions = visPos(lines);
  const totalFrames = 45;
  let frame = 0;

  const deathSpeed: Record<string, number> = {};
  for (const { r, c } of positions) {
    deathSpeed[`${r},${c}`] = 0.35 + Math.random() * 0.65;
  }

  setPhase(el, "phase-final");

  const iv = window.setInterval(() => {
    frame++;
    const p = frame / totalFrames;

    if (p > 0.6) setPhase(el, "phase-dying");

    for (const { r, c } of positions) {
      const ds = deathSpeed[`${r},${c}`]!;
      const lp = p / ds;

      if (lp > 1.0) {
        current[r]![c] = " ";
      } else if (lp > 0.8) {
        current[r]![c] = Math.random() < 0.3 ? rc(CH.brailleSparse) : " ";
      } else if (lp > 0.55) {
        current[r]![c] = rc(CH.brailleSparse);
      } else if (lp > 0.35) {
        current[r]![c] = rc(CH.braille);
      } else if (lp > 0.15) {
        current[r]![c] = rc(CH.brailleDense);
      } else {
        current[r]![c] =
          Math.random() < p * 0.4 ? rc(CH.brailleDense) : goalGrid[r]![c]!;
      }
    }

    el.textContent = gridStr(current);

    if (frame >= totalFrames) {
      clearInterval(iv);
      done();
    }
  }, 35);
}

/**
 * Ghost Entropy: logo fades through density phases into faint punctuation.
 */
function ghostEntropy(
  el: HTMLElement,
  logo: string,
  done: () => void
): void {
  const lines = logo.split("\n");
  const current = toGrid(lines);
  const goalGrid = toGrid(lines);
  const positions = visPos(lines);
  const phases = ["▓█", "▒▓", "░▒", CH.ghostMed, CH.ghostFaint, CH.dots];
  const totalFrames = 48;
  let frame = 0;

  const deathSpeed: Record<string, number> = {};
  for (const { r, c } of positions) {
    deathSpeed[`${r},${c}`] = 0.35 + Math.random() * 0.65;
  }

  setPhase(el, "phase-final");

  const iv = window.setInterval(() => {
    frame++;
    const p = frame / totalFrames;

    if (p > 0.5) setPhase(el, "phase-dying");
    else if (p > 0.25) setPhase(el, "phase-blocks");

    for (const { r, c } of positions) {
      const ds = deathSpeed[`${r},${c}`]!;
      const lp = p / ds;

      if (lp > 1.0) {
        current[r]![c] = " ";
      } else if (lp > 0.85) {
        current[r]![c] = Math.random() < 0.25 ? rc(CH.dots) : " ";
      } else if (lp > 0.15) {
        const phaseIdx = Math.min(
          Math.floor(((lp - 0.15) / 0.7) * phases.length),
          phases.length - 1
        );
        current[r]![c] = rc(phases[phaseIdx]!);
      } else {
        current[r]![c] =
          Math.random() < p * 0.3 ? rc("▓█") : goalGrid[r]![c]!;
      }
    }

    el.textContent = gridStr(current);

    if (frame >= totalFrames) {
      clearInterval(iv);
      done();
    }
  }, 35);
}
