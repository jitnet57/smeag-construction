// Lightweight CSV helpers — no external dependencies.
// Excel opens UTF-8 CSV correctly when a BOM is present, so Korean/PHP text
// and the ₱ sign survive round-trips.

type Cell = string | number | null | undefined;

function escapeCell(value: Cell): string {
  const s = value === null || value === undefined ? '' : String(value);
  // Quote if the cell contains a comma, quote, or newline.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build a CSV string (with header row) from a 2-D array of rows. */
export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\r\n');
}

/** Trigger a browser download of `content` as a UTF-8 (BOM) CSV file. */
export function downloadCsv(filename: string, rows: Cell[][]): void {
  const csv = toCsv(rows);
  // Prepend BOM so Excel detects UTF-8.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parse a simple CSV string into rows of string cells.
 * Handles quoted fields, escaped quotes, and CRLF/LF line endings.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  // Strip a leading BOM if present.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch === '\r') {
      // Swallow CR; the following LF (if any) closes the row.
      if (src[i + 1] !== '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      }
    } else {
      cell += ch;
    }
  }
  // Flush the final cell/row if the file didn't end with a newline.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
