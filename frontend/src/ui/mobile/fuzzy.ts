/**
 * Fuzzy path matching for the file search screen.
 *
 * Subsequence match with a score that rewards runs of consecutive hits,
 * hits at the start of a path segment, and hits in the file name over the
 * directory, so "tmts" finds "terminal-manager.ts" ahead of a deep
 * directory that happens to contain those letters.
 */

export interface FuzzyMatch {
  path: string;
  score: number;
  /** Indices into `path` that matched, for highlighting. */
  positions: number[];
}

const SEGMENT_SEPARATORS = new Set(["/", "-", "_", ".", " "]);

export function fuzzyScore(query: string, path: string): FuzzyMatch | null {
  if (query === "") return { path, score: 0, positions: [] };
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let qi = 0;
  let lastHit = -2;
  const nameStart = p.lastIndexOf("/") + 1;

  for (let i = 0; i < p.length && qi < q.length; i++) {
    if (p[i] !== q[qi]) continue;
    positions.push(i);
    let gain = 1;
    if (i === lastHit + 1) gain += 3; // consecutive run
    if (i === 0 || SEGMENT_SEPARATORS.has(p[i - 1]!)) gain += 2; // segment start
    if (i >= nameStart) gain += 2; // in the file name
    score += gain;
    lastHit = i;
    qi++;
  }
  if (qi < q.length) return null;
  // Shorter paths win ties: the match is a larger share of the string.
  score -= p.length / 100;
  return { path, score, positions };
}

export function fuzzyFilter(query: string, paths: string[], limit = 50): FuzzyMatch[] {
  const out: FuzzyMatch[] = [];
  for (const path of paths) {
    const m = fuzzyScore(query, path);
    if (m) out.push(m);
  }
  out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return out.slice(0, limit);
}
