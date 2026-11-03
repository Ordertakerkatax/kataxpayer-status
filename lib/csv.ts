/**
 * CSV for spreadsheets, the same helper as kataxpayer.com's lib/csv.ts. Excel
 * runs a cell starting =, +, - or @ as a formula, so those get a quote first;
 * build every export from these, never by hand.
 */
export function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function row(values: Array<string | number | null | undefined>): string {
  return values.map(cell).join(',');
}

/** BOM so Excel reads UTF-8; CRLF between rows. */
export function csv(lines: string[]): string {
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function csvHeaders(filename: string): HeadersInit {
  return {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  };
}
