/**
 * Tiny evaluator for `stats:` source expressions.
 *
 * Supports:
 *   count(<source>)
 *   count(<source>, <field> == <value>)
 *   count(<source>, <field> != <value>)
 *   count(<source>, <field> in [a, b, c])
 *   count(<source>, <field> not in [a, b, c])
 *   ratio(<statId>, <statId>)
 *   field(<source>, <fieldName>)        — first-row scalar access
 *
 * Format:
 *   percent  → number × 100, rounded to 1dp, suffixed "%"
 *
 * Anything that doesn't parse falls back to rendering the raw source
 * string. Errors don't blow up the whole bar.
 */

import type { StatConfig } from "./types";

export interface ResolvedStat {
  id: string;
  label: string;
  display: string;
  raw: number | null;
}

export function evaluateStats(
  stats: StatConfig[],
  allData: Record<string, Record<string, unknown>[]>,
): ResolvedStat[] {
  const resolved: ResolvedStat[] = [];
  const byId = new Map<string, number>();

  for (const stat of stats) {
    let raw: number | null;
    try {
      raw = evalExpr(stat.source, allData, byId);
    } catch {
      raw = null;
    }
    if (raw != null) byId.set(stat.id, raw);
    resolved.push({
      id: stat.id,
      label: stat.label,
      display: format(raw, stat.format ?? null),
      raw,
    });
  }

  return resolved;
}

function evalExpr(
  expr: string,
  allData: Record<string, Record<string, unknown>[]>,
  byId: Map<string, number>,
): number | null {
  const trimmed = expr.trim();

  const countMatch = /^count\((.+)\)$/s.exec(trimmed);
  if (countMatch) {
    const args = splitArgs(countMatch[1]!);
    if (args.length === 0) return null;
    const source = args[0]!.trim();
    const rows = allData[source];
    if (!rows) return null;
    if (args.length === 1) return rows.length;
    const pred = parsePredicate(args.slice(1).join(","));
    return rows.filter(pred).length;
  }

  const fieldMatch = /^field\((.+)\)$/s.exec(trimmed);
  if (fieldMatch) {
    const args = splitArgs(fieldMatch[1]!).map((a) => a.trim());
    if (args.length !== 2) return null;
    const rows = allData[args[0]!];
    if (!rows || rows.length === 0) return null;
    const v = rows[0]![args[1]!];
    if (typeof v === "number") return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  const ratioMatch = /^ratio\((.+)\)$/s.exec(trimmed);
  if (ratioMatch) {
    const args = splitArgs(ratioMatch[1]!).map((a) => a.trim());
    if (args.length !== 2) return null;
    const num = byId.get(args[0]!) ?? evalExpr(args[0]!, allData, byId);
    const denom = byId.get(args[1]!) ?? evalExpr(args[1]!, allData, byId);
    if (num == null || denom == null || denom === 0) return null;
    return num / denom;
  }

  // Bare reference to another stat id
  if (byId.has(trimmed)) return byId.get(trimmed)!;

  // Bare numeric literal
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

type Predicate = (row: Record<string, unknown>) => boolean;

function parsePredicate(input: string): Predicate {
  const text = input.trim();

  const inMatch = /^(\w+)\s+(not\s+in|in)\s+\[(.+)\]$/s.exec(text);
  if (inMatch) {
    const field = inMatch[1]!;
    const negate = inMatch[2]!.startsWith("not");
    const values = inMatch[3]!
      .split(",")
      .map((v) => v.trim().replace(/^["']|["']$/g, ""));
    return (row) => {
      const v = String(row[field] ?? "");
      return negate ? !values.includes(v) : values.includes(v);
    };
  }

  const eqMatch = /^(\w+)\s+(==|!=)\s+(.+)$/s.exec(text);
  if (eqMatch) {
    const field = eqMatch[1]!;
    const op = eqMatch[2]!;
    const target = eqMatch[3]!.trim().replace(/^["']|["']$/g, "");
    return (row) => {
      const v = String(row[field] ?? "");
      return op === "==" ? v === target : v !== target;
    };
  }

  return () => true;
}

function splitArgs(s: string): string[] {
  // Comma-split that respects [ ] brackets so `in [a, b]` stays intact.
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of s) {
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

function format(value: number | null, format: string | null): string {
  if (value == null) return "—";
  if (format === "percent") {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}
