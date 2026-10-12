import { redirect } from "next/navigation";
import { ensureMigrated } from "../db/client";
import { currentSession, type SessionContext } from "./session";

/** Server-component guard: unauthenticated visitors go to sign-in. */
export async function requireSession(): Promise<SessionContext> {
  await ensureMigrated();
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  return session;
}

export async function optionalSession(): Promise<SessionContext | null> {
  await ensureMigrated();
  return currentSession();
}
