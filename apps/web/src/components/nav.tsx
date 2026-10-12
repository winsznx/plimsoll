"use client";

import { Anchor, Bell, Buildings, ClockCounterClockwise, Files, GearSix, Handshake, SquaresFour, Vault } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

type Icon = ComponentType<{ weight?: "regular" | "fill" | "duotone" | "bold"; "aria-hidden"?: boolean }>;

const ITEMS: { href: string; label: string; icon: Icon }[] = [
  { href: "/overview", label: "Overview", icon: SquaresFour },
  { href: "/deals", label: "Deals", icon: Handshake },
  { href: "/shipments", label: "Shipments", icon: Anchor },
  { href: "/documents", label: "Documents", icon: Files },
  { href: "/settlements", label: "Settlements", icon: Vault },
  { href: "/counterparties", label: "Counterparties", icon: Buildings },
  { href: "/activity", label: "Activity", icon: ClockCounterClockwise },
];

const SECONDARY: { href: string; label: string; icon: Icon }[] = [
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: GearSix },
];

export function Nav({ unread, mismatches }: { unread: number; mismatches: number }) {
  const path = usePathname();
  const isActive = (href: string) => path === href || path.startsWith(`${href}/`);
  const link = (i: { href: string; label: string; icon: Icon }, badge: number) => {
    const active = isActive(i.href);
    const Glyph = i.icon;
    return (
      <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} title={i.label}>
        <Glyph weight={active ? "fill" : "regular"} aria-hidden />
        {i.label}
        {badge > 0 ? <span className="badge" aria-label={`${badge} need attention`}>{badge}</span> : null}
      </Link>
    );
  };
  return (
    <nav aria-label="Primary">
      <div className="nav">{ITEMS.map((i) => link(i, i.href === "/documents" ? mismatches : 0))}</div>
      <p className="nav-group" style={{ marginTop: 18 }}>
        Account
      </p>
      <div className="nav">{SECONDARY.map((i) => link(i, i.href === "/notifications" ? unread : 0))}</div>
    </nav>
  );
}
