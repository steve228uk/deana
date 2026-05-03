import { describe, expect, it } from "vitest";
import { calculateFindingRank } from "./ranking";

describe("finding ranking", () => {
  it("prioritizes personal genotype matches over missing coverage", () => {
    const matched = calculateFindingRank({
      evidenceTier: "high",
      outcome: "negative",
      repute: "bad",
      coverage: "full",
      publicationCount: 2,
      sources: [{ id: "clinvar", name: "ClinVar" }],
      matchedMarkers: [{ genotype: "CT", matchedAlleleCount: 1 }],
    });
    const missing = calculateFindingRank({
      evidenceTier: "high",
      outcome: "missing",
      repute: "bad",
      coverage: "missing",
      publicationCount: 200,
      sources: [{ id: "clinvar", name: "ClinVar" }],
      matchedMarkers: [{ genotype: null, matchedAlleleCount: null }],
    });

    expect(matched).toBeGreaterThan(missing);
  });

  it("lets high-magnitude SNPedia context outrank weaker primary context", () => {
    const weakPrimary = calculateFindingRank({
      evidenceTier: "emerging",
      outcome: "informational",
      repute: "not-set",
      coverage: "full",
      publicationCount: 1,
      sources: [{ id: "gwas", name: "GWAS Catalog" }],
      matchedMarkers: [{ genotype: "AG", matchedAlleleCount: null }],
    });
    const snpediaContext = calculateFindingRank({
      evidenceTier: "supplementary",
      outcome: "negative",
      repute: "bad",
      coverage: "full",
      publicationCount: 8,
      magnitude: 5,
      sources: [{ id: "snpedia", name: "SNPedia" }],
      matchedMarkers: [{ genotype: "AG", matchedAlleleCount: 1 }],
    });

    expect(snpediaContext).toBeGreaterThan(weakPrimary);
  });

  it("keeps low-magnitude common SNPedia pages below primary evidence", () => {
    const primary = calculateFindingRank({
      evidenceTier: "moderate",
      outcome: "negative",
      repute: "bad",
      coverage: "full",
      publicationCount: 1,
      sources: [{ id: "clinvar", name: "ClinVar" }],
      matchedMarkers: [{ genotype: "AG", matchedAlleleCount: 1 }],
    });
    const supplementary = calculateFindingRank({
      evidenceTier: "supplementary",
      outcome: "positive",
      repute: "good",
      coverage: "full",
      publicationCount: 0,
      magnitude: 0,
      sources: [{ id: "snpedia", name: "SNPedia" }],
      matchedMarkers: [{ genotype: "AG", matchedAlleleCount: null }],
    });

    expect(primary).toBeGreaterThan(supplementary);
  });

  it("keeps high-quality clinical evidence above high-magnitude SNPedia context", () => {
    const clinical = calculateFindingRank({
      evidenceTier: "high",
      outcome: "negative",
      repute: "bad",
      coverage: "full",
      publicationCount: 2,
      clinicalSignificance: "Pathogenic",
      clinvarStars: 3,
      sources: [{ id: "clinvar", name: "ClinVar" }],
      matchedMarkers: [{ genotype: "CT", matchedAlleleCount: 1 }],
    });
    const snpediaContext = calculateFindingRank({
      evidenceTier: "supplementary",
      outcome: "negative",
      repute: "bad",
      coverage: "full",
      publicationCount: 8,
      magnitude: 5,
      sources: [{ id: "snpedia", name: "SNPedia" }],
      matchedMarkers: [{ genotype: "CT", matchedAlleleCount: 1 }],
    });

    expect(clinical).toBeGreaterThan(snpediaContext);
  });

  it("boosts stronger ClinGen classifications", () => {
    const definitive = calculateFindingRank({
      evidenceTier: "high",
      outcome: "negative",
      repute: "bad",
      coverage: "full",
      publicationCount: 8,
      clingenClassification: "Definitive",
      sources: [{ id: "clingen", name: "ClinGen" }],
      matchedMarkers: [{ genotype: "CT", matchedAlleleCount: 1 }],
    });
    const limited = calculateFindingRank({
      evidenceTier: "high",
      outcome: "negative",
      repute: "bad",
      coverage: "full",
      publicationCount: 200,
      clingenClassification: "Limited",
      sources: [{ id: "clingen", name: "ClinGen" }],
      matchedMarkers: [{ genotype: "CT", matchedAlleleCount: 1 }],
    });

    expect(definitive).toBeGreaterThan(limited);
  });

  it("treats SNPedia magnitude 5 with citation support as high-value context", () => {
    const highMagnitude = calculateFindingRank({
      evidenceTier: "supplementary",
      outcome: "negative",
      repute: "bad",
      coverage: "full",
      publicationCount: 2,
      magnitude: 5,
      sources: [{ id: "snpedia", name: "SNPedia" }],
      matchedMarkers: [{ genotype: "AG", matchedAlleleCount: 1 }],
    });
    const lowerMagnitude = calculateFindingRank({
      evidenceTier: "supplementary",
      outcome: "negative",
      repute: "bad",
      coverage: "full",
      publicationCount: 2,
      magnitude: 2,
      sources: [{ id: "snpedia", name: "SNPedia" }],
      matchedMarkers: [{ genotype: "AG", matchedAlleleCount: 1 }],
    });

    expect(highMagnitude).toBeGreaterThan(lowerMagnitude);
  });

  it("does not let generic publication count make weak ClinGen dominate ClinVar stars", () => {
    const clinvarReviewed = calculateFindingRank({
      evidenceTier: "high",
      outcome: "negative",
      repute: "bad",
      coverage: "full",
      publicationCount: 3,
      clinvarStars: 3,
      sources: [{ id: "clinvar", name: "ClinVar" }],
      matchedMarkers: [{ genotype: "CT", matchedAlleleCount: 1 }],
    });
    const publicationHeavyLimitedClinGen = calculateFindingRank({
      evidenceTier: "high",
      outcome: "negative",
      repute: "bad",
      coverage: "full",
      publicationCount: 120,
      clingenClassification: "Limited",
      sources: [{ id: "clingen", name: "ClinGen" }],
      matchedMarkers: [{ genotype: "CT", matchedAlleleCount: 1 }],
    });

    expect(clinvarReviewed).toBeGreaterThan(publicationHeavyLimitedClinGen);
  });

  it("promotes CPIC and PharmGKB actionable pharmacogenomic evidence", () => {
    const cpicA = calculateFindingRank({
      evidenceTier: "high",
      outcome: "negative",
      repute: "mixed",
      coverage: "full",
      cpicLevel: "A",
      sources: [{ id: "cpic", name: "CPIC" }],
      matchedMarkers: [{ genotype: "CT", matchedAlleleCount: 1 }],
    });
    const pharmgkbOneA = calculateFindingRank({
      evidenceTier: "high",
      outcome: "negative",
      repute: "mixed",
      coverage: "full",
      pharmgkbLevel: "1A",
      sources: [{ id: "pharmgkb", name: "PharmGKB" }],
      matchedMarkers: [{ genotype: "CT", matchedAlleleCount: 1 }],
    });
    const weakGwas = calculateFindingRank({
      evidenceTier: "moderate",
      outcome: "negative",
      repute: "bad",
      coverage: "full",
      publicationCount: 1,
      gwasPValue: 4e-8,
      gwasHasReplication: false,
      sources: [{ id: "gwas", name: "GWAS Catalog" }],
      matchedMarkers: [{ genotype: "CT", matchedAlleleCount: 1 }],
    });

    expect(cpicA).toBeGreaterThan(weakGwas);
    expect(pharmgkbOneA).toBeGreaterThan(weakGwas);
  });

  it("uses publication support without overpowering stronger personal evidence", () => {
    const personallyMatched = calculateFindingRank({
      evidenceTier: "moderate",
      outcome: "negative",
      repute: "bad",
      coverage: "full",
      publicationCount: 1,
      matchedMarkers: [{ genotype: "CT", matchedAlleleCount: 1 }],
    });
    const publicationHeavyMissing = calculateFindingRank({
      evidenceTier: "high",
      outcome: "missing",
      repute: "bad",
      coverage: "missing",
      publicationCount: 500,
      matchedMarkers: [{ genotype: null, matchedAlleleCount: null }],
    });

    expect(personallyMatched).toBeGreaterThan(publicationHeavyMissing);
  });
});
