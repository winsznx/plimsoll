import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface RenderSpec {
  title: string;
  issuer: string;
  fields: [label: string, value: string][];
  table?: { columns: { label: string; x: number; align?: "left" | "right" }[]; rows: string[][] };
  footerFields?: [label: string, value: string][];
  /** Printed on every fixture so a synthetic document can never pass as a real one. */
  disclaimer: string;
}

const INK = rgb(0.08, 0.16, 0.19);
const MUTED = rgb(0.32, 0.42, 0.44);
const RULE = rgb(0.81, 0.85, 0.85);

/** Renders a deterministic, text-based trade document PDF (A4) for fixtures and demos. */
export async function renderTradeDocument(spec: RenderSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(spec.title);
  doc.setProducer("Plimsoll fixture renderer");
  doc.setCreator("Plimsoll");
  doc.setCreationDate(new Date("2026-10-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-10-01T00:00:00Z"));
  const page = doc.addPage([595.28, 841.89]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const left = 48;
  let y = 790;

  page.drawText(spec.title.toUpperCase(), { x: left, y, size: 17, font: bold, color: INK });
  y -= 18;
  page.drawText(spec.issuer, { x: left, y, size: 9, font: regular, color: MUTED });
  y -= 14;
  page.drawLine({ start: { x: left, y }, end: { x: 547, y }, thickness: 0.8, color: RULE });
  y -= 22;

  for (const [label, value] of spec.fields) {
    page.drawText(`${label}: ${value}`, { x: left, y, size: 10, font: regular, color: INK });
    y -= 15;
  }

  if (spec.table) {
    y -= 12;
    page.drawLine({ start: { x: left, y: y + 12 }, end: { x: 547, y: y + 12 }, thickness: 0.6, color: RULE });
    for (const col of spec.table.columns) {
      page.drawText(col.label, { x: col.x, y, size: 8.5, font: bold, color: MUTED });
    }
    y -= 6;
    page.drawLine({ start: { x: left, y }, end: { x: 547, y }, thickness: 0.6, color: RULE });
    y -= 14;
    for (const row of spec.table.rows) {
      row.forEach((cell, i) => {
        const col = spec.table!.columns[i]!;
        page.drawText(cell, { x: col.x, y, size: 9.5, font: regular, color: INK });
      });
      y -= 16;
    }
    page.drawLine({ start: { x: left, y: y + 6 }, end: { x: 547, y: y + 6 }, thickness: 0.6, color: RULE });
    y -= 14;
  }

  for (const [label, value] of spec.footerFields ?? []) {
    page.drawText(`${label}: ${value}`, { x: left, y, size: 10, font: bold, color: INK });
    y -= 15;
  }

  page.drawText(spec.disclaimer, { x: left, y: 40, size: 7.5, font: regular, color: MUTED });
  return doc.save({ useObjectStreams: false });
}

/**
 * Wraps page images into an A4 PDF with no text layer, the shape a flatbed scanner produces.
 * Used for fixtures that exercise the path where rule extraction finds nothing to read.
 */
export async function imageOnlyPdf(pngPages: Uint8Array[], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("Plimsoll fixture renderer (image only)");
  doc.setCreator("Plimsoll");
  doc.setCreationDate(new Date("2026-10-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-10-01T00:00:00Z"));
  for (const png of pngPages) {
    const image = await doc.embedPng(png);
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return doc.save({ useObjectStreams: false });
}
