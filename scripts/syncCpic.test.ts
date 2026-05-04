import { describe, expect, it } from "vitest";
import { deriveCpicVariantAllele, isReferenceAlleleDefinitionName } from "./syncCpic";

describe("isReferenceAlleleDefinitionName", () => {
  it("identifies CPIC reference definitions", () => {
    expect(isReferenceAlleleDefinitionName("*1")).toBe(true);
    expect(isReferenceAlleleDefinitionName("*1.001")).toBe(true);
    expect(isReferenceAlleleDefinitionName("Reference")).toBe(true);
    expect(isReferenceAlleleDefinitionName("rs2231142 reference (G)")).toBe(true);
  });

  it("does not classify non-reference star alleles as reference", () => {
    expect(isReferenceAlleleDefinitionName("*10")).toBe(false);
    expect(isReferenceAlleleDefinitionName("*2")).toBe(false);
    expect(isReferenceAlleleDefinitionName("rs2231142 variant (T)")).toBe(false);
  });
});

describe("deriveCpicVariantAllele", () => {
  it("returns a single unambiguous non-reference allele", () => {
    expect(deriveCpicVariantAllele(["t", "T"])).toBe("T");
  });

  it("returns null for ambiguous non-reference alleles", () => {
    expect(deriveCpicVariantAllele(["C", "T"])).toBeNull();
  });

  it("ignores non-SNV allele values", () => {
    expect(deriveCpicVariantAllele(["del", "A"])).toBe("A");
  });
});
