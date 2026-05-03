import { describe, expect, it } from "vitest";
import { clingenDiseaseWordsOverlap } from "./buildEvidencePack";

describe("clingenDiseaseWordsOverlap", () => {
  it("matches when a condition contains a key disease word", () => {
    expect(clingenDiseaseWordsOverlap(
      ["Hereditary breast and ovarian cancer syndrome"],
      "Hereditary breast and ovarian cancer",
    )).toBe(true);
  });

  it("matches when disease and condition share words in different order", () => {
    expect(clingenDiseaseWordsOverlap(
      ["Cardiomyopathy, dilated, 1A"],
      "Dilated cardiomyopathy",
    )).toBe(true);
  });

  it("does not match when conditions are for a clearly different disease", () => {
    expect(clingenDiseaseWordsOverlap(
      ["Fanconi anemia, complementation group D2"],
      "Hereditary breast and ovarian cancer",
    )).toBe(false);
  });

  it("returns true (no mismatch) for an empty conditions array", () => {
    expect(clingenDiseaseWordsOverlap([], "Hereditary breast and ovarian cancer")).toBe(false);
  });

  it("ignores stop words when matching", () => {
    // "and" is a stop word and should not cause a spurious match
    expect(clingenDiseaseWordsOverlap(
      ["Type 2 diabetes and insulin resistance"],
      "and",
    )).toBe(false);
  });

  it("matches partial disease name overlap", () => {
    expect(clingenDiseaseWordsOverlap(
      ["Long QT syndrome 1"],
      "Long QT syndrome",
    )).toBe(true);
  });

  it("does not match short words under 3 characters", () => {
    expect(clingenDiseaseWordsOverlap(
      ["QT disorder"],
      "QT",
    )).toBe(false);
  });

  it("matches across multiple conditions in the array", () => {
    expect(clingenDiseaseWordsOverlap(
      ["Unrelated condition", "Breast cancer susceptibility"],
      "Hereditary breast and ovarian cancer",
    )).toBe(true);
  });
});
