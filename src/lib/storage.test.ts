import { describe, expect, it } from "vitest";
import { stripProfileSupplementsForMetaStorage } from "./storage";
import { EVIDENCE_PACK_VERSION } from "./evidencePack";
import { makeParsedDnaFile } from "../test/fixtures";
import type { EvidenceSupplement } from "../types";

describe("profile storage normalization", () => {
  it("strips heavyweight evidence match records from profile metadata supplements", () => {
    const dna = makeParsedDnaFile();
    const supplement: EvidenceSupplement = {
      status: "complete",
      fetchedAt: "2026-04-25T00:00:00.000Z",
      attribution: "test",
      packVersion: EVIDENCE_PACK_VERSION,
      manifest: null,
      totalRsids: dna.markerCount,
      processedRsids: dna.markerCount,
      matchedRecords: [
        {
          record: {
            id: "gwas-rs762551-1",
            entryId: "local-trait-gwas-rs762551-1",
            sourceId: "gwas",
            role: "primary",
            category: "traits",
            subcategory: "association",
            markerIds: ["rs762551"],
            genes: ["CYP1A2"],
            title: "rs762551 caffeine association",
            url: "https://example.com/gwas",
            release: "test",
            evidenceLevel: "moderate",
            clinicalSignificance: "trait-association",
            repute: "not-set",
            pmids: ["123"],
            notes: ["test"],
          },
          matchedMarkers: [
            {
              rsid: "rs762551",
              genotype: "AC",
              chromosome: "15",
              position: 75041917,
              gene: "CYP1A2",
            },
          ],
        },
      ],
      unmatchedRsids: dna.markerCount - 1,
      failedItems: [],
      retries: 0,
    };

    const stored = stripProfileSupplementsForMetaStorage({ evidence: supplement });

    expect(stored?.evidence?.matchedRecords).toEqual([]);
    expect(stored?.evidence?.processedRsids).toBe(dna.markerCount);
    expect(supplement.matchedRecords).toHaveLength(1);
  });
});
