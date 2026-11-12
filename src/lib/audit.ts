// Append-only, hash-chained audit log. Editing any past entry breaks every hash after it.

export interface AuditEntry {
  seq: number;
  ts: number;
  type: string;
  data: unknown;
  prev: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

async function sha256(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const body = (e: Pick<AuditEntry, "seq" | "ts" | "type" | "data" | "prev">) =>
  JSON.stringify({ seq: e.seq, ts: e.ts, type: e.type, data: e.data, prev: e.prev });

export async function appendAudit(log: AuditEntry[], type: string, data: unknown, ts = Date.now()): Promise<AuditEntry[]> {
  const prev = log.length ? log[log.length - 1].hash : GENESIS;
  const base = { seq: log.length + 1, ts, type, data, prev };
  return [...log, { ...base, hash: await sha256(body(base)) }];
}

export async function verifyChain(log: AuditEntry[]): Promise<{ ok: true } | { ok: false; brokenAt: number }> {
  let prev = GENESIS;
  for (const e of log) {
    if (e.prev !== prev || e.hash !== (await sha256(body(e)))) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true };
}
