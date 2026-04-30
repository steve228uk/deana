import Papa from "papaparse";

const HEADER_SIGNALS = [
  "GENE SYMBOL",
  "GENE ID",
  "DISEASE LABEL",
  "DISEASE ID",
  "#Gene Symbol",
  "#ISCA ID",
  "Variation",
  "ClinVar Variation Id",
  "Allele Registry Id",
  "gene_symbol",
  "hgnc_id",
  "mondo_id",
];

export function detectDelimitedHeaderLine(
  text: string,
  delimiter: "," | "\t",
): string | null {
  const lines = text.split(/\r?\n/);

  return (
    lines.find((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;

      const matchingSignals = HEADER_SIGNALS.filter((signal) =>
        trimmed.toLowerCase().includes(signal.toLowerCase()),
      );

      return matchingSignals.length >= 2 && trimmed.includes(delimiter);
    }) ??
    lines.find((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("README");
    }) ??
    null
  );
}

export function parseHeadersFromDelimitedText(
  text: string,
  delimiter: "," | "\t",
): string[] {
  const headerLine = detectDelimitedHeaderLine(text, delimiter);

  if (!headerLine) return [];

  return headerLine
    .replace(/^﻿/, "")
    .split(delimiter)
    .map((header) =>
      header
        .trim()
        .replace(/^#/, "")
        .replace(/^"|"$/g, ""),
    )
    .filter(Boolean);
}

export function parseCsvWithDetectedHeader(text: string): Papa.ParseResult<Record<string, string>> {
  const lines = text.split(/\r?\n/);
  const headerLine = detectDelimitedHeaderLine(text, ",");
  const headerIndex = headerLine ? lines.indexOf(headerLine) : 0;
  const csv = lines.slice(headerIndex).join("\n");

  return Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
}

export function parseTsvWithDetectedHeader(text: string): Papa.ParseResult<Record<string, string>> {
  const lines = text.split(/\r?\n/);
  const headerLine = detectDelimitedHeaderLine(text, "\t");
  const headerIndex = headerLine ? lines.indexOf(headerLine) : 0;
  const tsv = lines.slice(headerIndex).join("\n");

  return Papa.parse<Record<string, string>>(tsv, {
    header: true,
    delimiter: "\t",
    skipEmptyLines: true,
  });
}

export function warnMissingFields(
  source: string,
  actualHeaders: string[],
  expectedFields: string[],
): void {
  const lower = actualHeaders.map((h) => h.toLowerCase());
  const missing = expectedFields.filter(
    (f) => !lower.includes(f.toLowerCase()),
  );
  if (missing.length > 0) {
    console.warn(
      `ClinGen [${source}]: expected fields not found: ${missing.join(", ")}`,
    );
  }
}
