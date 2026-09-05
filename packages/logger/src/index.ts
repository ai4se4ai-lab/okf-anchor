/**
 * `@okf-anchor/logger` — the one shared logger for the web app and the worker
 * (CLAUDE.md §9: "Log structured events; redact keys, tokens, and PII").
 *
 * Deliberately dependency-free: a leveled, timestamped, colorized single-line
 * formatter that reads well interleaved with the other `docker compose up`
 * service logs, plus a machine-parseable `key=value` tail for structured fields.
 */
import { redactMeta } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogMeta = Record<string, unknown>;

export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  /** Returns a logger that merges `bindings` into every call's meta. */
  child(bindings: LogMeta): Logger;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

const LEVEL_STYLE: Record<LogLevel, { label: string; color: string }> = {
  debug: { label: "DEBUG", color: "\x1b[90m" },
  info: { label: "INFO ", color: "\x1b[36m" },
  warn: { label: "WARN ", color: "\x1b[33m" },
  error: { label: "ERROR", color: "\x1b[31m" },
};

// A fixed, stable palette so the same service name always gets the same color
// across restarts — makes it easy to visually track one service's lines in a
// terminal interleaving several containers.
const SERVICE_PALETTE = [
  "\x1b[35m",
  "\x1b[32m",
  "\x1b[34m",
  "\x1b[36m",
  "\x1b[33m",
  "\x1b[95m",
  "\x1b[92m",
  "\x1b[94m",
];

function serviceColor(service: string): string {
  let hash = 0;
  for (let i = 0; i < service.length; i++) {
    hash = (hash * 31 + service.charCodeAt(i)) >>> 0;
  }
  return SERVICE_PALETTE[hash % SERVICE_PALETTE.length] as string;
}

function envLevel(): LogLevel {
  const raw = (process.env["LOG_LEVEL"] ?? "info").toLowerCase();
  return raw === "debug" || raw === "warn" || raw === "error" || raw === "info" ? raw : "info";
}

function colorEnabled(): boolean {
  if (process.env["NO_COLOR"]) return false;
  if (process.env["FORCE_COLOR"] === "1" || process.env["FORCE_COLOR"] === "true") return true;
  if (process.env["FORCE_COLOR"] === "0" || process.env["FORCE_COLOR"] === "false") return false;
  return process.stdout.isTTY === true;
}

function formatValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return /\s/.test(value) ? JSON.stringify(value) : value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatMeta(meta: LogMeta, color: boolean): string {
  const entries = Object.entries(meta);
  if (entries.length === 0) return "";
  const rendered = entries.map(([key, value]) => `${key}=${formatValue(value)}`).join(" ");
  return color ? ` ${DIM}${rendered}${RESET}` : ` ${rendered}`;
}

function formatStacks(meta: LogMeta, color: boolean): string {
  const stacks = Object.values(meta)
    .filter((v): v is Error => v instanceof Error && typeof v.stack === "string")
    .map((err) => err.stack as string);
  if (stacks.length === 0) return "";
  const body = stacks.join("\n");
  return color ? `\n${DIM}${body}${RESET}` : `\n${body}`;
}

const MIN_LEVEL = LEVEL_WEIGHT[envLevel()];
const COLOR = colorEnabled();

function write(service: string, level: LogLevel, message: string, meta?: LogMeta): void {
  if (LEVEL_WEIGHT[level] < MIN_LEVEL) return;
  const safeMeta = meta ? redactMeta(meta) : undefined;
  const ts = new Date().toISOString();
  const { label, color } = LEVEL_STYLE[level];
  const svc = serviceColor(service);
  const line = COLOR
    ? `${DIM}${ts}${RESET} ${color}${BOLD}${label}${RESET} ${svc}[${service}]${RESET} ${message}${safeMeta ? formatMeta(safeMeta, true) : ""}${safeMeta ? formatStacks(safeMeta, true) : ""}`
    : `${ts} ${label} [${service}] ${message}${safeMeta ? formatMeta(safeMeta, false) : ""}${safeMeta ? formatStacks(safeMeta, false) : ""}`;
  // Repo convention (eslint no-console) allows only warn/error; route debug/info
  // through console.warn so linting stays clean without pulling in a real stream API.
  (level === "error" ? console.error : console.warn)(line);
}

function build(service: string, bindings: LogMeta): Logger {
  const merge = (meta?: LogMeta): LogMeta | undefined =>
    meta || Object.keys(bindings).length > 0 ? { ...bindings, ...meta } : undefined;
  return {
    debug: (message, meta) => write(service, "debug", message, merge(meta)),
    info: (message, meta) => write(service, "info", message, merge(meta)),
    warn: (message, meta) => write(service, "warn", message, merge(meta)),
    error: (message, meta) => write(service, "error", message, merge(meta)),
    child: (childBindings) => build(service, { ...bindings, ...childBindings }),
  };
}

/** Create a logger tagged with `service` (e.g. `"api"`, `"worker"`). */
export function createLogger(service: string): Logger {
  return build(service, {});
}
