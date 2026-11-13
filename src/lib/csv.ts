/**
 * Escapa una celda CSV y neutraliza fórmulas de hoja de cálculo.
 *
 * Un nombre importado como `=HYPERLINK(...)` se ejecutaría al abrir el CSV en
 * Excel/Sheets. Se antepone un apóstrofo a los caracteres que inician fórmula.
 */
export function escapeCsvCell(value: unknown): string {
  let text = value == null ? "" : String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  // BOM para que Excel respete los acentos.
  return `\uFEFF${lines.join("\r\n")}`;
}

/**
 * Parser pequeño de CSV/TSV con soporte para campos entre comillas y comas
 * internas. No pretende cubrir todo RFC 4180, sólo la importación del panel.
 */
export function parseDelimited(text: string, forcedDelimiter?: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, "");
  const firstLine = normalized.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = forcedDelimiter ?? (firstLine.includes("\t") ? "\t" : ",");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

export function isImportHeaderRow(cells: string[]): boolean {
  const first = (cells[0] ?? "").trim().toLowerCase();
  return ["documento", "document", "doc", "identificacion", "identificación"].includes(first);
}
