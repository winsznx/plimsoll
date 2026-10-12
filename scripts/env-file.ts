import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
  }
  return out;
}

/** Merges `updates` into the env file, preserving keys this script does not own. */
export function writeEnvFile(path: string, updates: Record<string, string>, header: string): void {
  const merged = { ...readEnvFile(path), ...updates };
  const body = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(path, `${header}\n${body}\n`, { mode: 0o600 });
}
