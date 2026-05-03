import { describe, expect, it } from "vitest";
import { buildRiskAlleleMap, determineRiskAllele } from "./syncPharmgkb";

describe("determineRiskAllele", () => {
  describe("single-base allele entries", () => {
    it("returns the allele flagged with risk function", () => {
      expect(determineRiskAllele([
        { genotype: "A", function_: "Poor Metabolizer" },
        { genotype: "C", function_: "Normal Metabolizer" },
      ])).toBe("A");
    });

    it("returns the single unambiguous allele when no function info", () => {
      expect(determineRiskAllele([
        { genotype: "T", function_: "" },
      ])).toBe("T");
    });

    it("returns null when multiple alleles have no function info", () => {
      expect(determineRiskAllele([
        { genotype: "A", function_: "" },
        { genotype: "T", function_: "" },
      ])).toBeNull();
    });

    it("prefers risk allele over normal when both are present", () => {
      expect(determineRiskAllele([
        { genotype: "G", function_: "Normal Function" },
        { genotype: "A", function_: "No Function" },
      ])).toBe("A");
    });
  });

  describe("two-character genotype entries", () => {
    it("extracts risk allele from homozygous risk genotype", () => {
      expect(determineRiskAllele([
        { genotype: "CC", function_: "Normal Metabolizer" },
        { genotype: "CT", function_: "Intermediate Metabolizer" },
        { genotype: "TT", function_: "Poor Metabolizer" },
      ])).toBe("T");
    });

    it("derives risk allele from normal-homozygous + het pair", () => {
      expect(determineRiskAllele([
        { genotype: "CC", function_: "Normal Metabolizer" },
        { genotype: "CT", function_: "" },
      ])).toBe("T");
    });

    it("handles reversed allele order in het entry", () => {
      expect(determineRiskAllele([
        { genotype: "GG", function_: "Normal Function" },
        { genotype: "AG", function_: "" },
      ])).toBe("A");
    });

    it("returns null when het does not contain the normal allele", () => {
      // Malformed / multi-allelic: het is "AG" but normal homozygous is "CC"
      expect(determineRiskAllele([
        { genotype: "CC", function_: "Normal Metabolizer" },
        { genotype: "AG", function_: "" },
      ])).toBeNull();
    });

    it("returns null when no function info and no homozygous risk entry", () => {
      expect(determineRiskAllele([
        { genotype: "CT", function_: "" },
      ])).toBeNull();
    });

    it("returns null for haplotype-style entries", () => {
      expect(determineRiskAllele([
        { genotype: "CYP2D6 *4/*4", function_: "Poor Metabolizer" },
      ])).toBeNull();
    });
  });

  it("returns null for an empty entry list", () => {
    expect(determineRiskAllele([])).toBeNull();
  });
});

describe("buildRiskAlleleMap", () => {
  it("builds a map from a minimal alleles TSV", () => {
    const tsv = [
      "Clinical Annotation ID\tGenotype/Allele\tAllele Function",
      "12345\tTT\tPoor Metabolizer",
      "12345\tCT\tIntermediate Metabolizer",
      "12345\tCC\tNormal Metabolizer",
      "99999\tA\tDecreased Function",
    ].join("\n");

    const map = buildRiskAlleleMap(tsv);
    expect(map.get("12345")).toBe("T");
    expect(map.get("99999")).toBe("A");
  });

  it("returns an empty map for a TSV with only headers", () => {
    expect(buildRiskAlleleMap("Clinical Annotation ID\tGenotype/Allele\tAllele Function\n")).toEqual(new Map());
  });

  it("ignores rows where risk allele cannot be determined", () => {
    const tsv = [
      "Clinical Annotation ID\tGenotype/Allele\tAllele Function",
      "11111\tCYP2D6 *4/*4\tPoor Metabolizer",
    ].join("\n");
    expect(buildRiskAlleleMap(tsv).has("11111")).toBe(false);
  });

  it("handles missing Allele Function column gracefully", () => {
    const tsv = [
      "Clinical Annotation ID\tGenotype/Allele",
      "55555\tA",
    ].join("\n");
    // Single-base with no function: returned only if unambiguous
    expect(buildRiskAlleleMap(tsv).get("55555")).toBe("A");
  });
});
