"use client";

import { useState } from "react";
import styles from "./workspace.module.css";

/** Shows a credential exactly once, right after creation. The server keeps only a hash or a preview. */
export function SecretReveal({ title, value, onDismiss }: { title: string; value: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={styles.reveal} role="status" aria-live="polite">
      <strong className="small">{title}</strong>
      <code>{value}</code>
      <p className="tiny muted">Store it now. Shown once, never retrievable.</p>
      <div className="row wrap">
        <button type="button" className="btn sm" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn sm ghost" onClick={onDismiss}>
          I&apos;ve stored it
        </button>
      </div>
    </div>
  );
}
