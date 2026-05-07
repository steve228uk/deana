import { describe, expect, it } from "vitest";
import {
  candidateRowsFromGwasRow,
  parseStructuredAlleleEvidence,
  resolveCandidatesFromStructuredSources,
} from "./syncGwasPmidAlleles";

function gwasRow(overrides: Record<string, string>): Record<string, string> {
  return {
    PUBMEDID: "32386320",
    "MAPPED_TRAIT": "Adult diffuse glioma (IDH mutation, 1p/19q codeletion)",
    "STRONGEST SNP-RISK ALLELE": "rs55705857-?",
    SNPS: "rs55705857",
    "SNP_ID_CURRENT": "55705857",
    "P-VALUE": "8E-26",
    "STUDY ACCESSION": "GCST000001",
    ...overrides,
  };
}

describe("candidateRowsFromGwasRow", () => {
  it("selects unknown GWAS risk alleles for PMID resolution", () => {
    expect(candidateRowsFromGwasRow(gwasRow({}))).toEqual([
      {
        pmid: "32386320",
        rsid: "rs55705857",
        trait: "Adult diffuse glioma (IDH mutation, 1p/19q codeletion)",
        studyAccession: "GCST000001",
        strongestAllele: "rs55705857-?",
      },
    ]);
  });

  it("skips rows whose GWAS risk allele is already known", () => {
    expect(candidateRowsFromGwasRow(gwasRow({
      "STRONGEST SNP-RISK ALLELE": "rs55705857-G",
    }))).toEqual([]);
  });
});

describe("parseStructuredAlleleEvidence", () => {
  it("extracts rsID and risk allele from HTML tables", () => {
    const evidence = parseStructuredAlleleEvidence({
      sourceType: "pmc-table",
      sourceUrl: "https://example.com/article.xml",
      sourceLabel: "PMID 32386320 table",
      text: `
        <table>
          <tr><th>Variant</th><th>Risk allele</th><th>Trait</th></tr>
          <tr><td>rs55705857</td><td>G</td><td>Adult diffuse glioma</td></tr>
        </table>
      `,
    });

    expect(evidence).toEqual([
      {
        rsid: "rs55705857",
        riskAllele: "G",
        sourceType: "pmc-table",
        sourceUrl: "https://example.com/article.xml",
        sourceLabel: "PMID 32386320 table",
      },
    ]);
  });

  it("extracts rsID and effect allele from delimited summary statistics", () => {
    const evidence = parseStructuredAlleleEvidence({
      sourceType: "summary-statistics",
      sourceUrl: "https://example.com/summary.tsv",
      sourceLabel: "GCST000001 summary statistics",
      text: "SNP\tEffect allele\tP\nrs55705857\tG\t8E-26\n",
    });

    expect(evidence[0]).toMatchObject({
      rsid: "rs55705857",
      riskAllele: "G",
      sourceType: "summary-statistics",
    });
  });
});

describe("resolveCandidatesFromStructuredSources", () => {
  const candidates = candidateRowsFromGwasRow(gwasRow({}));

  it("resolves all PMID/rsID candidate traits when structured evidence has one allele", () => {
    const { resolved, conflicts } = resolveCandidatesFromStructuredSources(candidates, [
      {
        sourceType: "supplement-table",
        sourceUrl: "https://example.com/supp.tsv",
        sourceLabel: "PMID 32386320 supplementary table",
        text: "rsid\teffect allele\nrs55705857\tG\n",
      },
    ]);

    expect(conflicts).toEqual([]);
    expect(resolved).toEqual([
      {
        pmid: "32386320",
        rsid: "rs55705857",
        riskAllele: "G",
        sourceType: "supplement-table",
        sourceUrl: "https://example.com/supp.tsv",
        sourceLabel: "PMID 32386320 supplementary table",
        studyAccession: "GCST000001",
        trait: "Adult diffuse glioma (IDH mutation, 1p/19q codeletion)",
        confidence: "structured-table",
      },
    ]);
  });

  it("skips conflicting structured allele evidence", () => {
    const { resolved, conflicts } = resolveCandidatesFromStructuredSources(candidates, [
      {
        sourceType: "supplement-table",
        sourceUrl: "https://example.com/supp-1.tsv",
        sourceLabel: "supp 1",
        text: "rsid\teffect allele\nrs55705857\tG\n",
      },
      {
        sourceType: "supplement-table",
        sourceUrl: "https://example.com/supp-2.tsv",
        sourceLabel: "supp 2",
        text: "rsid\teffect allele\nrs55705857\tA\n",
      },
    ]);

    expect(resolved).toEqual([]);
    expect(conflicts).toEqual([{ pmid: "32386320", rsid: "rs55705857", alleles: ["G", "A"] }]);
  });
});
