import { extractTextItems, getDocumentProxy } from "unpdf";

export interface DocCell {
  text: string;
  x: number;
}

export interface DocLine {
  page: number;
  text: string;
  cells: DocCell[];
  bbox: [number, number, number, number] | null;
}

const SAME_ROW_TOLERANCE = 2.5;
const CELL_GAP = 14;

/** Groups positioned PDF text items into visual rows, keeping column cells separate. */
export async function pdfToLines(bytes: Uint8Array): Promise<{ lines: DocLine[]; pages: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, items } = await extractTextItems(pdf);
  const lines: DocLine[] = [];

  items.forEach((pageItems, pageIndex) => {
    const rows: { y: number; items: typeof pageItems }[] = [];
    for (const item of pageItems) {
      if (!item.str.trim()) continue;
      const row = rows.find((r) => Math.abs(r.y - item.y) <= SAME_ROW_TOLERANCE);
      if (row) row.items.push(item);
      else rows.push({ y: item.y, items: [item] });
    }
    rows.sort((a, b) => b.y - a.y);

    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      const cells: DocCell[] = [];
      let lastEnd = -Infinity;
      for (const item of row.items) {
        const prev = cells[cells.length - 1];
        if (prev && item.x - lastEnd < CELL_GAP) prev.text += (item.x - lastEnd > 1 ? " " : "") + item.str;
        else cells.push({ text: item.str, x: item.x });
        lastEnd = item.x + item.width;
      }
      for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
      const x0 = row.items[0]!.x;
      const height = Math.max(...row.items.map((i) => i.height || i.fontSize));
      lines.push({
        page: pageIndex + 1,
        text: cells.map((c) => c.text).join("  "),
        cells,
        bbox: [x0, row.y, lastEnd - x0, height],
      });
    }
  });

  return { lines, pages: totalPages };
}

/** Plain-text documents: columns are separated by tabs, pipes or runs of 2+ spaces. */
export function textToLines(text: string): DocLine[] {
  return text
    .split(/\r?\n/)
    .map((raw) => raw.trimEnd())
    .filter((raw) => raw.trim().length > 0)
    .map((raw) => {
      const parts = raw.split(/\t|\s*\|\s*|\s{2,}/).map((p) => p.trim()).filter(Boolean);
      return { page: 1, text: raw.trim(), cells: parts.map((p, i) => ({ text: p, x: i * 100 })), bbox: null };
    });
}
