import { describe, expect, it } from "vitest";
import { buildAlleleAnnotationMap, normalizePharmgkbAllele } from "./syncPharmgkb";

describe("normalizePharmgkbAllele", () => {
  it("normalizes two-base genotype entries for exact matching", () => {
    expect(normalizePharmgkbAllele("TA")).toEqual({ genotype: "AT", riskAllele: null });
  });

  it("normalizes single-base allele entries for allele matching", () => {
    expect(normalizePharmgkbAllele(" t ")).toEqual({ genotype: null, riskAllele: "T" });
  });

  it("rejects haplotype-style entries", () => {
    expect(normalizePharmgkbAllele("CYP2D6 *4/*4")).toBeNull();
  });
});

describe("buildAlleleAnnotationMap", () => {
  it("builds exact genotype and allele rows from a minimal alleles TSV", () => {
    const tsv = [
      "Clinical Annotation ID\tGenotype/Allele\tAnnotation Text\tAllele Function",
      "12345\tTT\tPatients with TT may have altered response\t",
      "12345\tCT\tPatients with CT may have intermediate response\t",
      "99999\tA\tPatients with A may respond\tDecreased Function",
    ].join("\n");

    const map = buildAlleleAnnotationMap(tsv);
    expect(map.get("12345")).toEqual([
      { genotype: "TT", riskAllele: null, annotationText: "Patients with TT may have altered response" },
      { genotype: "CT", riskAllele: null, annotationText: "Patients with CT may have intermediate response" },
    ]);
    expect(map.get("99999")).toEqual([
      { genotype: null, riskAllele: "A", annotationText: "Patients with A may respond" },
    ]);
  });

  it("returns an empty map for a TSV with only headers", () => {
    expect(buildAlleleAnnotationMap("Clinical Annotation ID\tGenotype/Allele\tAnnotation Text\n")).toEqual(new Map());
  });

  it("ignores rows where genotype or allele cannot be matched locally", () => {
    const tsv = [
      "Clinical Annotation ID\tGenotype/Allele\tAnnotation Text",
      "11111\tCYP2D6 *4/*4\tPoor Metabolizer",
    ].join("\n");
    expect(buildAlleleAnnotationMap(tsv).has("11111")).toBe(false);
  });

  it("deduplicates repeated genotype rows", () => {
    const tsv = [
      "Clinical Annotation ID\tGenotype/Allele\tAnnotation Text",
      "55555\tTA\tSame row",
      "55555\tAT\tSame row",
    ].join("\n");
    expect(buildAlleleAnnotationMap(tsv).get("55555")).toEqual([
      { genotype: "AT", riskAllele: null, annotationText: "Same row" },
    ]);
  });
});
