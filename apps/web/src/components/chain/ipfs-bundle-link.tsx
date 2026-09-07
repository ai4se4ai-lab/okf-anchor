"use client";

import { useState } from "react";
import { ipfsGatewayHref, looksLikeIpfsCid } from "./format";

/**
 * Copy `text`, returning whether it landed. `navigator.clipboard` only exists in
 * a secure context (HTTPS or localhost); when the app is opened over plain HTTP
 * from another machine (http://<lan-ip>:3000) it is `undefined`, so fall back to
 * the legacy `execCommand("copy")` off a hidden textarea.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/**
 * The IPFS content behind one anchor, shown in full: the complete bundle CID
 * (never truncated — it is what you verify against), a gateway download link,
 * the raw gateway URL, and the `ipfs get` equivalent. A CID is a content hash,
 * so downloading it *is* the verification: re-hash the bytes and compare.
 *
 * Degrades cleanly when there is no gateway configured or the CID is the
 * offline local-storage `okf1:` format (never resolvable on a public gateway).
 */
export function IpfsBundleLink({
  cid,
  gatewayUrl,
  label,
}: {
  cid: string;
  gatewayUrl: string | null;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const href = ipfsGatewayHref(gatewayUrl, cid);
  const resolvable = looksLikeIpfsCid(cid);

  async function copyCid() {
    if (await writeToClipboard(cid)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    // If both paths fail the CID is still select-all inline — nothing else to do.
  }

  return (
    <div className="rounded-md border border-slate-200 p-2 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{label ? `IPFS content · ${label}` : "IPFS content"}</p>
        <button
          type="button"
          onClick={copyCid}
          className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {copied ? "copied" : "copy CID"}
        </button>
      </div>

      <code className="hash mt-1 block select-all" data-testid="ipfs-cid">
        {cid}
      </code>

      {href ? (
        <div className="mt-1.5 space-y-0.5 text-xs">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline hover:text-slate-900 dark:hover:text-slate-100"
          >
            Download bundle from IPFS ↗
          </a>
          <p className="break-all text-[11px] text-slate-400 dark:text-slate-500">{href}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            CLI: <code className="font-mono">ipfs get {cid}</code> — the CID is the content hash, so a successful
            fetch verifies the bytes.
          </p>
        </div>
      ) : resolvable ? (
        <p className="mt-1.5 text-xs text-slate-500">
          No public IPFS gateway configured — set <code className="font-mono">IPFS_GATEWAY_URL</code> to expose a
          download link. Fetch by CID from any IPFS node in the meantime.
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-slate-500">
          Stored on local dev storage — not resolvable on a public IPFS gateway.
        </p>
      )}
    </div>
  );
}
