import type { BankProvider } from "./plaid";

export type Row = Record<string, unknown>;

export type Handler = (ctx: {
  req: Request;
  db: D1Database;
  params: string[];
  url: URL;
  email: string;
  bank?: BankProvider;
  backups?: R2Bucket;
}) => Promise<Response>;
export type Route = [method: string, pattern: RegExp, handler: Handler];

export async function all(db: D1Database, sql: string, ...binds: unknown[]): Promise<Row[]> {
  return (await db.prepare(sql).bind(...binds).all<Row>()).results;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const notFound = (msg = "Not found") => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const MAX_BODY_BYTES = 2_000_000;

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new HttpError(413, "Request too large.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "Request too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw badRequest("Body must be JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("Body must be a JSON object.");
  return body as Record<string, unknown>;
}

// Small validators: they throw a 400 with a readable message instead of letting bad data through.

export function str(body: Record<string, unknown>, key: string, opts: { max?: number } = {}): string {
  const v = body[key];
  if (typeof v !== "string" || v.trim() === "") throw badRequest(`${key} is required.`);
  const t = v.trim();
  if (t.length > (opts.max ?? 200)) throw badRequest(`${key} is too long.`);
  return t;
}

export function optStr(body: Record<string, unknown>, key: string, opts: { max?: number } = {}): string | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v === null || v === "") return null;
  if (typeof v !== "string") throw badRequest(`${key} must be text.`);
  const t = v.trim();
  if (t.length > (opts.max ?? 2000)) throw badRequest(`${key} is too long.`);
  return t === "" ? null : t;
}

export function int(body: Record<string, unknown>, key: string, opts: { min?: number; max?: number } = {}): number {
  const v = body[key];
  if (typeof v !== "number" || !Number.isInteger(v)) throw badRequest(`${key} must be a whole number.`);
  if (opts.min !== undefined && v < opts.min) throw badRequest(`${key} is too small.`);
  if (opts.max !== undefined && v > opts.max) throw badRequest(`${key} is too large.`);
  return v;
}

export function optInt(body: Record<string, unknown>, key: string, opts: { min?: number; max?: number } = {}): number | null | undefined {
  if (!(key in body)) return undefined;
  if (body[key] === null) return null;
  return int(body, key, opts);
}

export function optBool(body: Record<string, unknown>, key: string): boolean | undefined {
  if (!(key in body)) return undefined;
  if (typeof body[key] !== "boolean") throw badRequest(`${key} must be true or false.`);
  return body[key] as boolean;
}

export function idFrom(param: string | undefined): number {
  const n = Number(param);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
}

/** Turn a partial update into "col = ?" pieces, skipping undefined fields. */
export function setClause(fields: Record<string, unknown>): { sql: string; values: unknown[] } {
  const cols: string[] = [];
  const values: unknown[] = [];
  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    cols.push(`${col} = ?`);
    values.push(typeof val === "boolean" ? (val ? 1 : 0) : val);
  }
  if (cols.length === 0) throw badRequest("Nothing to update.");
  return { sql: cols.join(", "), values };
}

/** D1 surfaces constraint failures as messages; translate the common one. */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}
