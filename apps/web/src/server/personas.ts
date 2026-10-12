import type { PersonaOption } from "@/components/auth/persona-picker";
import { DEMO_PERSONAS } from "./seed";

const DOES: Record<PersonaOption["key"], string> = {
  BUYER: "Funds escrow, reviews findings, approves milestones, may dispute.",
  SUPPLIER: "Uploads invoices and corrected documents, accepts terms.",
  INSPECTOR: "Appointed independent approver for the carrier-handoff tranche.",
  FORWARDER: "Uploads transport copies and records shipment events.",
  RESOLVER: "Named in the terms; the only party who can split disputed funds.",
};

export function personaOptions(): PersonaOption[] {
  return (Object.keys(DEMO_PERSONAS) as PersonaOption["key"][]).map((key) => ({ key, name: DEMO_PERSONAS[key].name, org: DEMO_PERSONAS[key].org, title: DEMO_PERSONAS[key].title, does: DOES[key] }));
}
