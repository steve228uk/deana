import { describe, expect, it } from "vitest";
import {
  clinicalSignificanceLabel,
  normalizeClinicalSignificance,
  normalizeConditionKey,
  normalizeConditions,
} from "./normalization";

describe("normalization", () => {
  it("normalizes noisy clinical significance values", () => {
    expect(normalizeClinicalSignificance("Conflicting classifications of pathogenicity; association")).toBe("conflicting");
    expect(normalizeClinicalSignificance("Pathogenic/Likely pathogenic")).toBe("pathogenic-likely-pathogenic");
    expect(clinicalSignificanceLabel("pathogenic-likely-pathogenic")).toBe("Pathogenic / likely pathogenic");
  });

  it("deduplicates related condition names", () => {
    expect(normalizeConditionKey("male-pattern baldness")).toBe(normalizeConditionKey("1.7x chance of baldness"));
    expect(normalizeConditions(["male-pattern baldness", "baldness", "1.2x chance of baldness"])).toEqual(["baldness"]);
  });
});
