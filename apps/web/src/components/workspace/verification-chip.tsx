import { Chip } from "@/components/chip";

/** "Verified" is reserved for completed business identity verification; email never grants it. */
export function VerificationChip({ state, hint = true }: { state: string; hint?: boolean }) {
  if (state === "verified") return <Chip tone="confirmed">Verified</Chip>;
  if (state === "sample_fixture") return <Chip tone="neutral">Sample fixture</Chip>;
  if (!hint) return <Chip tone="awaiting">Unverified</Chip>;
  return (
    <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <Chip tone="awaiting">Unverified</Chip>
      <span className="tiny muted">Email alone never verifies</span>
    </span>
  );
}
