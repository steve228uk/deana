import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  detectDelimitedHeaderLine,
  parseCsvWithDetectedHeader,
  parseTsvWithDetectedHeader,
} from "./parseDelimited";
import {
  extractPmidsFromRow,
  makeClinGenRecordId,
  normaliseHgncId,
  normaliseMondoId,
  splitListField,
} from "./normalise";
import { parseGeneDiseaseValidityText } from "./importGeneDiseaseValidity";
import { parseDosageSensitivityCsvText, parseDosageSensitivityTsvText } from "./importDosageSensitivity";
import { parseVariantPathogenicityText } from "./importVariantPathogenicity";
import { parseClinicalActionabilityJson } from "./importClinicalActionability";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "__fixtures__", name), "utf-8");

// --- parseDelimited ---

describe("detectDelimitedHeaderLine", () => {
  it("detects headers after README/banner rows in CSV", () => {
    const text = fixture("gene_disease_validity.csv");
    const line = detectDelimitedHeaderLine(text, ",");
    expect(line).toContain("GENE SYMBOL");
    expect(line).toContain("CLASSIFICATION");
  });

  it("detects headers in TSV without banner rows", () => {
    const text = fixture("dosage_sensitivity_grch38.tsv");
    const line = detectDelimitedHeaderLine(text, "\t");
    expect(line).toContain("Gene Symbol");
    expect(line).toContain("Haploinsufficiency Score");
  });

  it("returns null for empty text", () => {
    expect(detectDelimitedHeaderLine("", ",")).toBeNull();
  });
});

describe("parseCsvWithDetectedHeader", () => {
  it("parses CSV with quoted commas correctly", () => {
    const csv = `NAME,DESCRIPTION\nFoo,"Bar, baz"\nQux,"Quux"`;
    const result = parseCsvWithDetectedHeader(csv);
    expect(result.data).toHaveLength(2);
    expect(result.data[1]["DESCRIPTION"]).toBe("Quux");
  });

  it("skips README rows and parses real data rows", () => {
    const text = fixture("gene_disease_validity.csv");
    const result = parseCsvWithDetectedHeader(text);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty("GENE SYMBOL");
    expect(result.data[0]).toHaveProperty("CLASSIFICATION");
  });
});

describe("parseTsvWithDetectedHeader", () => {
  it("parses TSV fields correctly", () => {
    const text = fixture("dosage_sensitivity_grch38.tsv");
    const result = parseTsvWithDetectedHeader(text);
    expect(result.data.length).toBeGreaterThan(0);
    // TSV header starts with #Gene Symbol — papaparse preserves the raw header name
    expect(result.data[0]).toHaveProperty("#Gene Symbol");
    expect(result.data[0]).toHaveProperty("Haploinsufficiency Score");
  });
});

// --- normalise ---

describe("normaliseHgncId", () => {
  it("adds HGNC: prefix when missing", () => {
    expect(normaliseHgncId("1100")).toBe("HGNC:1100");
  });

  it("preserves existing HGNC: prefix", () => {
    expect(normaliseHgncId("HGNC:1100")).toBe("HGNC:1100");
  });

  it("handles case-insensitive prefix deduplication", () => {
    expect(normaliseHgncId("hgnc:1100")).toBe("HGNC:1100");
  });

  it("returns null for empty string", () => {
    expect(normaliseHgncId("")).toBeNull();
    expect(normaliseHgncId(null)).toBeNull();
    expect(normaliseHgncId(undefined)).toBeNull();
  });
});

describe("normaliseMondoId", () => {
  it("adds MONDO: prefix when missing", () => {
    expect(normaliseMondoId("0011450")).toBe("MONDO:0011450");
  });

  it("preserves existing MONDO: prefix", () => {
    expect(normaliseMondoId("MONDO:0011450")).toBe("MONDO:0011450");
  });

  it("returns null for empty", () => {
    expect(normaliseMondoId("")).toBeNull();
    expect(normaliseMondoId(null)).toBeNull();
  });
});

describe("splitListField", () => {
  it("splits by semicolons", () => {
    expect(splitListField("a;b;c")).toEqual(["a", "b", "c"]);
  });

  it("splits by commas", () => {
    expect(splitListField("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("splits by pipes", () => {
    expect(splitListField("a|b|c")).toEqual(["a", "b", "c"]);
  });

  it("returns empty array for null/undefined", () => {
    expect(splitListField(null)).toEqual([]);
    expect(splitListField(undefined)).toEqual([]);
  });

  it("trims whitespace from values", () => {
    expect(splitListField("a ; b ; c")).toEqual(["a", "b", "c"]);
  });
});

describe("extractPmidsFromRow", () => {
  it("extracts PMID columns dynamically by prefix", () => {
    const row = {
      "Haploinsufficiency PMID1": "12345678",
      "Haploinsufficiency PMID2": "87654321",
      "Haploinsufficiency PMID3": "",
      "Triplosensitivity PMID1": "99999999",
    };
    expect(extractPmidsFromRow(row, "Haploinsufficiency")).toEqual([
      "12345678",
      "87654321",
    ]);
    expect(extractPmidsFromRow(row, "Triplosensitivity")).toEqual(["99999999"]);
  });

  it("handles extra PMID columns without crashing", () => {
    const row: Record<string, string> = {};
    for (let i = 1; i <= 10; i++) {
      row[`Haploinsufficiency PMID${i}`] = i <= 5 ? `1000000${i}` : "";
    }
    const pmids = extractPmidsFromRow(row, "Haploinsufficiency");
    expect(pmids).toHaveLength(5);
  });
});

describe("makeClinGenRecordId", () => {
  it("joins non-null parts with __", () => {
    // colons are allowed in the id regex so HGNC:1100 → hgnc:1100
    expect(makeClinGenRecordId(["gene_disease_validity", "HGNC:1100", "MONDO:0011450"])).toBe(
      "gene_disease_validity__hgnc:1100__mondo:0011450",
    );
  });

  it("filters out null and undefined", () => {
    expect(makeClinGenRecordId(["source", null, "value"])).toBe("source__value");
  });
});

// --- importGeneDiseaseValidity ---

describe("parseGeneDiseaseValidityText", () => {
  it("parses gene-disease validity CSV with README rows", () => {
    const text = fixture("gene_disease_validity.csv");
    const records = parseGeneDiseaseValidityText(text);
    expect(records.length).toBeGreaterThan(0);
  });

  it("normalises HGNC IDs correctly", () => {
    const text = fixture("gene_disease_validity.csv");
    const records = parseGeneDiseaseValidityText(text);
    const brca1 = records.find((r) => r.geneSymbol === "BRCA1");
    expect(brca1?.hgncId).toBe("HGNC:1100");
  });

  it("normalises MONDO IDs correctly", () => {
    const text = fixture("gene_disease_validity.csv");
    const records = parseGeneDiseaseValidityText(text);
    const brca1 = records.find((r) => r.geneSymbol === "BRCA1");
    expect(brca1?.mondoId).toBe("MONDO:0011450");
  });

  it("preserves raw source rows", () => {
    const text = fixture("gene_disease_validity.csv");
    const records = parseGeneDiseaseValidityText(text);
    expect(records[0].raw).toHaveProperty("GENE SYMBOL");
    expect(records[0].raw).toHaveProperty("CLASSIFICATION");
  });

  it("sets source to gene_disease_validity", () => {
    const text = fixture("gene_disease_validity.csv");
    const records = parseGeneDiseaseValidityText(text);
    expect(records.every((r) => r.source === "gene_disease_validity")).toBe(true);
  });

  it("includes fetchedAt timestamp", () => {
    const text = fixture("gene_disease_validity.csv");
    const records = parseGeneDiseaseValidityText(text);
    expect(records[0].fetchedAt).toBeTruthy();
    expect(new Date(records[0].fetchedAt).toISOString()).toBe(records[0].fetchedAt);
  });

  it("does not crash when extra columns appear", () => {
    const csv = [
      "GENE SYMBOL,GENE ID (HGNC),DISEASE LABEL,DISEASE ID (MONDO),MOI,SOP,CLASSIFICATION,ONLINE REPORT,CLASSIFICATION DATE,GCEP,EXTRA_COLUMN_1,EXTRA_COLUMN_2",
      "BRCA1,HGNC:1100,Test Disease,MONDO:0000001,AD,SOP8,Definitive,https://example.com,2020-01-01,GCEP1,extra1,extra2",
    ].join("\n");
    expect(() => parseGeneDiseaseValidityText(csv)).not.toThrow();
    const records = parseGeneDiseaseValidityText(csv);
    expect(records).toHaveLength(1);
  });

  it("skips separator rows from live ClinGen CSV exports", () => {
    const csv = [
      "GENE SYMBOL,GENE ID (HGNC),DISEASE LABEL,DISEASE ID (MONDO),MOI,SOP,CLASSIFICATION,ONLINE REPORT,CLASSIFICATION DATE,GCEP",
      "+++++++++++,++++++++++++++,+++++++++++++,++++++++++++++++++,+++++++++,+++++++++,++++++++++++++,+++++++++++++,+++++++++++++++++++,+++++++++++++++++++",
      "BRCA1,HGNC:1100,Test Disease,MONDO:0000001,AD,SOP8,Definitive,https://example.com,2020-01-01,GCEP1",
    ].join("\n");

    const records = parseGeneDiseaseValidityText(csv);

    expect(records).toHaveLength(1);
    expect(records[0].geneSymbol).toBe("BRCA1");
  });
});

// --- importDosageSensitivity ---

describe("parseDosageSensitivityCsvText", () => {
  it("parses dosage sensitivity gene CSV", () => {
    const text = fixture("dosage_sensitivity_genes.csv");
    const records = parseDosageSensitivityCsvText(text, "gene");
    expect(records.length).toBeGreaterThan(0);
  });

  it("preserves raw source rows", () => {
    const text = fixture("dosage_sensitivity_genes.csv");
    const records = parseDosageSensitivityCsvText(text, "gene");
    expect(records[0].raw).toHaveProperty("GENE SYMBOL");
  });

  it("does not crash when extra columns appear", () => {
    const csv = [
      "GENE SYMBOL,GENE ID,HAPLOINSUFFICIENCY SCORE,TRIPLOSENSITIVITY SCORE,DATE LAST EVALUATED,EXTRA_NEW_COL",
      "BRCA1,HGNC:1100,3,0,2020-01-01,somevalue",
    ].join("\n");
    expect(() => parseDosageSensitivityCsvText(csv, "gene")).not.toThrow();
  });
});

describe("parseDosageSensitivityTsvText", () => {
  it("parses dosage sensitivity FTP TSV", () => {
    const text = fixture("dosage_sensitivity_grch38.tsv");
    const records = parseDosageSensitivityTsvText(text, "gene", "GRCh38");
    expect(records.length).toBeGreaterThan(0);
  });

  it("normalises HGNC IDs from TSV", () => {
    const text = fixture("dosage_sensitivity_grch38.tsv");
    const records = parseDosageSensitivityTsvText(text, "gene", "GRCh38");
    const mecp2 = records.find((r) => r.geneSymbol === "MECP2");
    expect(mecp2?.hgncId).toBe("HGNC:6990");
  });
});

// --- importVariantPathogenicity ---

describe("parseVariantPathogenicityText", () => {
  it("parses variant pathogenicity TSV", () => {
    const text = fixture("variant_pathogenicity.tsv");
    const records = parseVariantPathogenicityText(text);
    expect(records.length).toBeGreaterThan(0);
  });

  it("uses uuid as record ID when present", () => {
    const text = fixture("variant_pathogenicity.tsv");
    const records = parseVariantPathogenicityText(text);
    expect(records[0].id).toContain("abc123-uuid");
  });

  it("normalises MONDO IDs", () => {
    const text = fixture("variant_pathogenicity.tsv");
    const records = parseVariantPathogenicityText(text);
    expect(records[0].mondoId).toBe("MONDO:0011450");
  });

  it("preserves raw source rows", () => {
    const text = fixture("variant_pathogenicity.tsv");
    const records = parseVariantPathogenicityText(text);
    expect(records[0].raw).toHaveProperty("Variation");
    expect(records[0].raw).toHaveProperty("Assertion");
  });

  it("sets source to variant_pathogenicity", () => {
    const text = fixture("variant_pathogenicity.tsv");
    const records = parseVariantPathogenicityText(text);
    expect(records.every((r) => r.source === "variant_pathogenicity")).toBe(true);
  });
});

// --- importClinicalActionability ---

describe("parseClinicalActionabilityJson", () => {
  it("parses flat JSON array", () => {
    const json = JSON.parse(fixture("clinical_actionability_adult_flat.json"));
    const records = parseClinicalActionabilityJson(json, "Adult");
    expect(records.length).toBe(3);
  });

  it("handles JSON wrapped in data property", () => {
    const json = JSON.parse(fixture("clinical_actionability_adult_flat.json"));
    const wrapped = { data: json };
    const records = parseClinicalActionabilityJson(wrapped, "Adult");
    expect(records.length).toBe(3);
  });

  it("handles JSON wrapped in results property", () => {
    const json = JSON.parse(fixture("clinical_actionability_adult_flat.json"));
    const wrapped = { results: json };
    const records = parseClinicalActionabilityJson(wrapped, "Adult");
    expect(records.length).toBe(3);
  });

  it("handles current ClinGen columns/rows table responses", () => {
    const json = {
      columns: [
        "docId",
        "geneOrVariant",
        "disease",
        "contextIri",
        "outcome",
        "intervention",
        "overall",
      ],
      rows: [
        [
          "AC1084",
          "CYP27A1",
          "Cerebrotendinous xanthomatosis",
          "https://actionability.clinicalgenome.org/ac/Adult/api/sepio/doc/AC1084",
          "Morbidity and mortality resulting from progressive lipid accumulation",
          "Referral to specialist for treatment including bile acids",
          "10CN",
        ],
      ],
    };

    const records = parseClinicalActionabilityJson(json, "Adult");

    expect(records).toHaveLength(1);
    expect(records[0].geneSymbol).toBe("CYP27A1");
    expect(records[0].diseaseLabel).toBe("Cerebrotendinous xanthomatosis");
    expect(records[0].reportUrl).toBe(
      "https://actionability.clinicalgenome.org/ac/Adult/api/sepio/doc/AC1084",
    );
    expect(records[0].raw).toHaveProperty("overall", "10CN");
  });

  it("sets context correctly", () => {
    const json = JSON.parse(fixture("clinical_actionability_adult_flat.json"));
    const records = parseClinicalActionabilityJson(json, "Adult");
    expect(records.every((r) => r.source === "clinical_actionability")).toBe(true);
  });

  it("preserves raw source rows", () => {
    const json = JSON.parse(fixture("clinical_actionability_adult_flat.json"));
    const records = parseClinicalActionabilityJson(json, "Adult");
    expect(records[0].raw).toHaveProperty("gene");
  });

  it("returns empty array for empty JSON", () => {
    expect(parseClinicalActionabilityJson([], "Adult")).toEqual([]);
    expect(parseClinicalActionabilityJson({ data: [] }, "Pediatric")).toEqual([]);
  });
});
