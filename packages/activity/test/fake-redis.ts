import type { ActivityRedisLike } from "../src/redis.js";

interface Entry {
  id: string;
  fields: string[];
}

/**
 * A tiny in-memory Redis-streams double — enough of `xadd` / `xrange` /
 * `xrevrange` / `xread` / `expire` for the activity recorder and reader, so the
 * unit tests need no live Redis.
 */
export class FakeRedisStreams implements ActivityRedisLike {
  status = "ready";
  readonly streams = new Map<string, Entry[]>();
  readonly ttl = new Map<string, number>();
  private ms = 1_000_000_000_000;
  private seq = 0;

  async connect(): Promise<void> {}
  disconnect(): void {
    this.status = "end";
  }

  private nextId(): string {
    this.seq += 1;
    return `${this.ms}-${this.seq}`;
  }

  private static parseCount(rest: (string | number)[]): number | undefined {
    const i = rest.findIndex((a) => String(a).toUpperCase() === "COUNT");
    return i >= 0 ? Number(rest[i + 1]) : undefined;
  }

  async xadd(...args: (string | number)[]): Promise<string | null> {
    const a = args.map(String);
    const key = a[0]!;
    let i = 1;
    let maxlen: number | undefined;
    if (a[i]?.toUpperCase() === "MAXLEN") {
      i += 1;
      if (a[i] === "~" || a[i] === "=") i += 1;
      maxlen = Number(a[i]);
      i += 1;
    }
    // id position (we only ever pass "*")
    i += 1;
    const fields = a.slice(i);
    const id = this.nextId();
    const list = this.streams.get(key) ?? [];
    list.push({ id, fields });
    if (maxlen !== undefined && list.length > maxlen) list.splice(0, list.length - maxlen);
    this.streams.set(key, list);
    return id;
  }

  private range(key: string, start: string, end: string, count?: number, reverse = false): [string, string[]][] {
    let list = [...(this.streams.get(key) ?? [])];
    const exclusiveStart = start.startsWith("(") ? start.slice(1) : null;
    const lo = exclusiveStart ?? (start === "-" || start === "+" ? null : start);
    const hi = end === "+" || end === "-" ? null : end;
    list = list.filter((e) => {
      if (exclusiveStart && cmpId(e.id, exclusiveStart) <= 0) return false;
      if (!exclusiveStart && lo && cmpId(e.id, lo) < 0) return false;
      if (hi && cmpId(e.id, hi) > 0) return false;
      return true;
    });
    if (reverse) list.reverse();
    if (count !== undefined) list = list.slice(0, count);
    return list.map((e) => [e.id, e.fields]);
  }

  async xrange(key: string, start: string, end: string, ...rest: (string | number)[]): Promise<[string, string[]][]> {
    return this.range(key, start, end, FakeRedisStreams.parseCount(rest), false);
  }

  async xrevrange(key: string, start: string, end: string, ...rest: (string | number)[]): Promise<[string, string[]][]> {
    // xrevrange takes (key, end, start) semantically; our callers pass ("+","-")
    return this.range(key, end, start, FakeRedisStreams.parseCount(rest), true);
  }

  async xread(...args: (string | number)[]): Promise<[string, [string, string[]][]][] | null> {
    const a = args.map(String);
    const si = a.findIndex((x) => x.toUpperCase() === "STREAMS");
    const rest = a.slice(si + 1);
    const half = rest.length / 2;
    const keys = rest.slice(0, half);
    const ids = rest.slice(half);
    const out: [string, [string, string[]][]][] = [];
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k]!;
      const id = ids[k]!;
      if (id === "$") continue; // "only new" — nothing is newer in a synchronous fake
      const entries = this.range(key, `(${id === "0" ? "0-0" : id}`, "+");
      if (entries.length > 0) out.push([key, entries]);
    }
    return out.length > 0 ? out : null;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.ttl.set(key, seconds);
    return 1;
  }
}

function cmpId(a: string, b: string): number {
  const [am, as] = a.split("-").map(Number);
  const [bm, bs] = b.split("-").map(Number);
  if (am! !== bm!) return am! - bm!;
  return (as ?? 0) - (bs ?? 0);
}
