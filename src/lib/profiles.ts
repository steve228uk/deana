import { EVIDENCE_PACK_VERSION } from "./evidencePack";
import { generateReport, REPORT_VERSION } from "./reportEngine";
import { ParsedDnaFile, ProfileSupplements, SavedProfile } from "../types";

function createId(): string {
  return crypto.randomUUID?.() ?? `deana-${Date.now()}`;
}

export function createProfile(
  name: string,
  dna: ParsedDnaFile,
  supplements?: ProfileSupplements,
): SavedProfile {
  return {
    id: createId(),
    name,
    fileName: dna.fileName,
    createdAt: new Date().toISOString(),
    dna,
    supplements,
    reportVersion: REPORT_VERSION,
    evidencePackVersion: EVIDENCE_PACK_VERSION,
    report: generateReport(dna, supplements),
  };
}
