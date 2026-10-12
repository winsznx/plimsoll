"use client";

import { useState } from "react";

/** Monospace identifier with copy and an optional explorer link. */
export function Hash({ value, href, label, full = false }: { value: string; href?: string | null; label?: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  const shown = full || value.length <= 18 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <span className="hash" title={value}>
      {href ? (
        <a className="ext mono" href={href} target="_blank" rel="noreferrer" aria-label={`${label ?? "Identifier"} ${value} on explorer`}>
          {shown}
        </a>
      ) : (
        <span>{shown}</span>
      )}
      <button type="button" onClick={copy} aria-label={`Copy ${label ?? "identifier"}`}>
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
