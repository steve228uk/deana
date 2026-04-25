import { EVIDENCE_PACK_VERSION } from "./evidencePack";
import { generateReport, REPORT_VERSION } from "./reportEngine";
import { ParsedDnaFile, ProfileSupplements, SavedProfile, SnpediaSupplement } from "../types";

function createId(): string {
  return crypto.randomUUID?.() ?? `deana-${Date.now()}`;
}

export function createProfile(
  name: string,
  dna: ParsedDnaFile,
  supplements?: ProfileSupplements | SnpediaSupplement,
): SavedProfile {
  const normalizedSupplements = supplements && "matchedFindings" in supplements ? { snpedia: supplements } : supplements;

  return {
    id: createId(),
    name,
    fileName: dna.fileName,
    createdAt: new Date().toISOString(),
    dna,
    supplements: normalizedSupplements,
    reportVersion: REPORT_VERSION,
    evidencePackVersion: EVIDENCE_PACK_VERSION,
    report: generateReport(dna, normalizedSupplements),
  };
}
