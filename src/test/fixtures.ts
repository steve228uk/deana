import { buildEntrySearchText } from "../lib/explorer";
import { ParsedDnaFile, ProfileMeta, SavedProfile, SavedProfileSummary, StoredReportEntry } from "../types";
import { createProfile } from "../lib/profiles";

export function makeParsedDnaFile(): ParsedDnaFile {
  return {
    provider: "AncestryDNA",
    build: "GRCh37",
    markerCount: 12,
    fileName: "ancestry-kit.txt",
    importedFrom: "text",
    markers: [
      ["rs429358", "19", 45411941, "CT"],
      ["rs7412", "19", 45412079, "CC"],
      ["rs6025", "1", 169519049, "CT"],
      ["rs1799963", "11", 46761055, "GG"],
      ["rs1800562", "6", 26091179, "AG"],
      ["rs1799945", "6", 26093141, "CG"],
      ["rs1801133", "1", 11796321, "CT"],
      ["rs12913832", "15", 28156872, "GG"],
      ["rs4988235", "2", 136608646, "CT"],
      ["rs762551", "15", 75041917, "AC"],
      ["rs1815739", "11", 66560624, "CC"],
      ["rs4244285", "10", 94781859, "AG"],
    ],
  };
}

export function makeSavedProfile(overrides: Partial<SavedProfile> = {}): SavedProfile {
  return {
    ...createProfile("Stephen", makeParsedDnaFile()),
    ...overrides,
  };
}

export function makeProfileSummary(overrides: Partial<SavedProfileSummary> = {}): SavedProfileSummary {
  const profile = makeSavedProfile();

  return {
    id: profile.id,
    name: profile.name,
    fileName: profile.fileName,
    createdAt: profile.createdAt,
    dna: {
      provider: profile.dna.provider,
      build: profile.dna.build,
      markerCount: profile.dna.markerCount,
    },
    reportVersion: profile.reportVersion,
    evidencePackVersion: profile.evidencePackVersion,
    report: {
      overview: profile.report.overview,
    },
    ...overrides,
  };
}

export function makeProfileMeta(overrides: Partial<ProfileMeta> = {}): ProfileMeta {
  const profile = makeSavedProfile();

  return {
    id: profile.id,
    name: profile.name,
    fileName: profile.fileName,
    createdAt: profile.createdAt,
    dna: profile.dna,
    supplements: profile.supplements,
    reportVersion: profile.reportVersion,
    evidencePackVersion: profile.evidencePackVersion,
    report: {
      reportVersion: profile.report.reportVersion,
      evidencePackVersion: profile.report.evidencePackVersion,
      overview: profile.report.overview,
      tabs: profile.report.tabs,
      facets: profile.report.facets,
    },
    ...overrides,
  };
}

export function makeStoredReportEntries(profileId = "profile-1"): StoredReportEntry[] {
  const profile = makeSavedProfile({ id: profileId });
  return profile.report.entries.map((entry) => ({
    ...entry,
    profileId,
    searchText: buildEntrySearchText(entry),
  }));
}
