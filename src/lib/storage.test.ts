import { describe, expect, it } from "vitest";
import { compareStoredChatMessages, ensureCurrentProfile, stripProfileSupplementsForMetaStorage } from "./storage";
import { EVIDENCE_PACK_VERSION } from "./evidencePack";
import { makeParsedDnaFile, makeSavedProfile } from "../test/fixtures";
import type { EvidenceSupplement, StoredChatMessage } from "../types";

describe("profile storage normalization", () => {
  it("preserves reports generated against an older evidence pack", () => {
    const staleProfile = makeSavedProfile({
      evidencePackVersion: "legacy-pack",
    });
    staleProfile.report = {
      ...staleProfile.report,
      evidencePackVersion: "legacy-pack",
      overview: {
        ...staleProfile.report.overview,
        evidencePackVersion: "legacy-pack",
      },
    };

    const normalized = ensureCurrentProfile(staleProfile);

    expect(normalized.evidencePackVersion).toBe("legacy-pack");
    expect(normalized.report.evidencePackVersion).toBe("legacy-pack");
    expect(normalized.report.overview.evidencePackVersion).toBe("legacy-pack");
  });

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

describe("chat message storage", () => {
  it("orders equal-timestamp chat messages as user before assistant", () => {
    const createdAt = "2026-04-26T12:00:00.000Z";
    const assistant: StoredChatMessage = {
      id: "message-assistant",
      threadId: "thread-1",
      profileId: "profile-1",
      role: "assistant",
      content: "Answer",
      createdAt,
    };
    const user: StoredChatMessage = {
      id: "message-user",
      threadId: "thread-1",
      profileId: "profile-1",
      role: "user",
      content: "Question",
      createdAt,
    };

    expect([assistant, user].sort(compareStoredChatMessages).map((message) => message.role)).toEqual(["user", "assistant"]);
  });
});
