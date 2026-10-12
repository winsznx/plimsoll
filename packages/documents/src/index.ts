import type { DocumentType, ExtractedField, ExtractedLineItem } from "@plimsoll/domain";
import { pdfToLines, textToLines, type DocLine } from "./lines";
import { classifyDocument, extractFields } from "./parse";

export * from "./lines";
export * from "./parse";
export * from "./render";
export * from "./fixtures";

export const SUPPORTED_MEDIA_TYPES = ["application/pdf", "text/plain"] as const;
export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export interface DocumentAnalysis {
  detectedType: DocumentType;
  typeConfidence: number;
  pages: number;
  lines: DocLine[];
  fields: ExtractedField[];
  lineItems: ExtractedLineItem[];
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** Checks the bytes, not the declared header, so a renamed executable is never parsed. */
export function sniffMediaType(bytes: Uint8Array): SupportedMediaType | null {
  if (PDF_MAGIC.every((b, i) => bytes[i] === b)) return "application/pdf";
  const sample = bytes.subarray(0, 4096);
  const printable = sample.every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b !== 127));
  if (printable) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return "text/plain";
    } catch {
      return null;
    }
  }
  return null;
}

export async function analyzeDocument(bytes: Uint8Array, mediaType: SupportedMediaType): Promise<DocumentAnalysis> {
  const { lines, pages } = mediaType === "application/pdf" ? await pdfToLines(bytes) : { lines: textToLines(new TextDecoder().decode(bytes)), pages: 1 };
  const { type, confidence } = classifyDocument(lines);
  const { fields, lineItems } = extractFields(lines);
  return { detectedType: type, typeConfidence: confidence, pages, lines, fields, lineItems };
}
