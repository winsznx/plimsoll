"use client";

import { ArrowRight, Boat, MagnifyingGlass, Scales, ShoppingCart, Storefront } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api, errorMessage } from "@/lib/api";
import styles from "./persona-picker.module.css";

export interface PersonaOption {
  key: "BUYER" | "SUPPLIER" | "INSPECTOR" | "FORWARDER" | "RESOLVER";
  name: string;
  org: string;
  title: string;
  does: string;
}

const GLYPH: Record<PersonaOption["key"], ReactNode> = {
  BUYER: <ShoppingCart aria-hidden />,
  SUPPLIER: <Storefront aria-hidden />,
  INSPECTOR: <MagnifyingGlass aria-hidden />,
  FORWARDER: <Boat aria-hidden />,
  RESOLVER: <Scales aria-hidden />,
};

const GROUPS: { label: string; keys: PersonaOption["key"][] }[] = [
  { label: "Trading parties", keys: ["BUYER", "SUPPLIER"] },
  { label: "Named in the terms", keys: ["INSPECTOR", "FORWARDER", "RESOLVER"] },
];

/** One-click entry into the seeded testnet scenario; every persona signs with labelled demo custody keys. */
export function PersonaPicker({ personas, next = "/overview" }: { personas: PersonaOption[]; next?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enter = async (key: PersonaOption["key"]) => {
    setBusy(key);
    setError(null);
    try {
      await api("/auth/demo", { body: { persona: key } });
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };
  const groups = GROUPS.map((g) => ({ ...g, personas: g.keys.flatMap((k) => personas.filter((p) => p.key === k)) })).filter((g) => g.personas.length > 0);

  return (
    <div className={styles.picker}>
      {groups.map((g) => (
        <div key={g.label} className={styles.group}>
          <p className={styles.groupLabel}>{g.label}</p>
          <div className={styles.grid} data-count={g.personas.length}>
            {g.personas.map((p) => (
              <button key={p.key} type="button" className={styles.card} onClick={() => enter(p.key)} disabled={busy !== null} aria-busy={busy === p.key}>
                <span className={styles.top}>
                  <span className={styles.role}>{p.key.toLowerCase()}</span>
                  <span className={styles.glyph}>{GLYPH[p.key]}</span>
                </span>
                <strong className={styles.org}>{p.org}</strong>
                <span className={styles.who}>
                  {p.name} · {p.title}
                </span>
                <span className={styles.does}>{p.does}</span>
                <span className={styles.enter} aria-hidden="true">
                  {busy === p.key ? "Entering…" : "Enter"}
                  <ArrowRight />
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
