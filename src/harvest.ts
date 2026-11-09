import type { HarvestRow } from "../shared/types";
import { isIsoDate } from "../shared/time";

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

/** Harvest exports dates as YYYY-MM-DD, or MM/DD/YYYY depending on account settings. */
function toIso(raw: string): string | null {
  const s = raw.trim();
  if (isIsoDate(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const iso = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return isIsoDate(iso) ? iso : null;
  }
  return null;
}

export interface ParsedHarvest {
  rows: HarvestRow[];
  problems: string[];
}

const REQUIRED = ["Date", "Client", "Project", "Task", "Hours"];

/** Read a Harvest "Detailed time" CSV export. */
export function parseHarvest(text: string): ParsedHarvest {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], problems: ["The file is empty."] };

  const header = table[0].map((h) => h.trim());
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const missing = REQUIRED.filter((n) => col(n) === -1);
  if (missing.length) {
    return {
      rows: [],
      problems: [`This doesn't look like a Harvest time export. Missing columns: ${missing.join(", ")}.`],
    };
  }

  const idx = {
    date: col("Date"),
    client: col("Client"),
    project: col("Project"),
    task: col("Task"),
    notes: col("Notes"),
    hours: col("Hours"),
    invoiced: col("Invoiced?"),
    rate: col("Billable Rate"),
  };

  const rows: HarvestRow[] = [];
  const problems: string[] = [];
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (j: number) => (j >= 0 ? (r[j] ?? "").trim() : "");
    const date = toIso(get(idx.date));
    const hours = Number(get(idx.hours));
    if (!date || !get(idx.client) || !get(idx.project) || !get(idx.task) || !Number.isFinite(hours) || hours < 0) {
      problems.push(`Line ${line} was skipped: it's missing a date, client, project, task or hours.`);
      return;
    }
    const rate = Number(get(idx.rate).replace(/[$,]/g, ""));
    rows.push({
      date,
      client: get(idx.client),
      project: get(idx.project),
      task: get(idx.task),
      notes: get(idx.notes),
      minutes: Math.round(hours * 60),
      billableRateCents: get(idx.rate) && Number.isFinite(rate) ? Math.round(rate * 100) : null,
      invoiced: /^(yes|true|1)$/i.test(get(idx.invoiced)),
    });
  });

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { rows, problems };
}

/** A stable key per row, so importing the same file twice never duplicates entries. */
export async function withKeys(rows: HarvestRow[]): Promise<(HarvestRow & { key: string })[]> {
  const seen = new Map<string, number>();
  const out: (HarvestRow & { key: string })[] = [];
  for (const r of rows) {
    const base = [r.date, r.client, r.project, r.task, r.notes, r.minutes].join("\u001f").toLowerCase();
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${base}\u001f${n}`));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    out.push({ ...r, key: `harvest:${hex.slice(0, 40)}` });
  }
  return out;
}
