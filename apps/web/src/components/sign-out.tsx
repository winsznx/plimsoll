"use client";

import { SignOut } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn ghost sm"
      onClick={async () => {
        await api("/auth/logout", { method: "POST" });
        router.push("/");
        router.refresh();
      }}
    >
      <SignOut aria-hidden />
      Sign out
    </button>
  );
}
