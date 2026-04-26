import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DEANA_GITHUB_URL,
  MarketingFirstVisit,
  MarketingReturning,
  PrivacyModal,
  RemoveReportModal,
  SavedReportCard,
  UploadReportModal,
} from "../components/deana/marketing";
import { ParsedDnaFile, SavedProfileSummary } from "../types";

interface HomeScreenProps {
  profiles: SavedProfileSummary[];
  isLibraryReady: boolean;
  parseFile: (file: File) => Promise<ParsedDnaFile>;
  removeProfile: (id: string) => Promise<void>;
  startProcessing: (name: string, parsed: ParsedDnaFile) => void;
}

function suggestedProfileName(fileName: string): string {
  return fileName.replace(/\.(?:vcf\.gz|zip|txt|csv|vcf|gz)$/i, "");
}

function toReportCard(profile: SavedProfileSummary): SavedReportCard {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.dna.provider,
    build: profile.report.overview.build,
    markerCount: profile.dna.markerCount,
    coverageScore: profile.report.overview.coverageScore,
    interpretedFindings:
      profile.report.overview.curatedMarkerMatches +
      (profile.report.overview.localEvidenceEntryMatches ?? profile.report.overview.evidenceMatchedFindings ?? 0),
    localEvidenceFindings:
      profile.report.overview.localEvidenceEntryMatches ?? profile.report.overview.evidenceMatchedFindings ?? 0,
    createdAt: profile.createdAt,
  };
}

export function HomeScreen({
  profiles,
  isLibraryReady,
  parseFile,
  removeProfile,
  startProcessing,
}: HomeScreenProps) {
  const navigate = useNavigate();
  const [modalStep, setModalStep] = useState<"choose-file" | "name-profile" | null>(null);
  const [parsed, setParsed] = useState<ParsedDnaFile | null>(null);
  const [profileName, setProfileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [reportPendingRemoval, setReportPendingRemoval] = useState<SavedReportCard | null>(null);
  const [isRemovingReport, setIsRemovingReport] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function openUpload() {
    setModalStep("choose-file");
    setParsed(null);
    setProfileName("");
    setError(null);
  }

  function closeUpload() {
    if (isParsing) return;
    setModalStep(null);
    setParsed(null);
    setProfileName("");
    setError(null);
  }

  async function handleFile(file: File) {
    setIsParsing(true);
    setError(null);

    try {
      const nextParsed = await parseFile(file);
      setParsed(nextParsed);
      setProfileName(suggestedProfileName(file.name));
      setModalStep("name-profile");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Parsing failed.");
    } finally {
      setIsParsing(false);
    }
  }

  function confirmProfile() {
    if (!parsed) return;
    const trimmedName = profileName.trim();
    if (!trimmedName) {
      setError("Give the profile a name before saving it.");
      return;
    }

    startProcessing(trimmedName, parsed);
    closeUpload();
    navigate("/processing");
  }

  async function confirmRemoveReport() {
    if (!reportPendingRemoval) return;

    setIsRemovingReport(true);
    setRemoveError(null);

    try {
      await removeProfile(reportPendingRemoval.id);
      setReportPendingRemoval(null);
    } catch (nextError) {
      setRemoveError(nextError instanceof Error ? nextError.message : "Could not remove this report.");
    } finally {
      setIsRemovingReport(false);
    }
  }

  const reportCards = profiles.map(toReportCard);

  return (
    <>
      {!isLibraryReady || profiles.length === 0 ? (
        <MarketingFirstVisit
          onUpload={openUpload}
          onPrivacy={() => setShowPrivacy(true)}
        />
      ) : (
        <MarketingReturning
          reports={reportCards}
          onCreateNew={openUpload}
          onOpenReport={(id) => navigate(`/explorer/${id}?tab=overview`)}
          onRemoveReport={(id) => {
            const report = reportCards.find((candidate) => candidate.id === id);
            if (report) {
              setRemoveError(null);
              setReportPendingRemoval(report);
            }
          }}
          onPrivacy={() => setShowPrivacy(true)}
        />
      )}

      {modalStep ? (
        <UploadReportModal
          step={modalStep}
          parsed={parsed ?? undefined}
          profileName={profileName}
          isParsing={isParsing}
          error={error}
          onClose={closeUpload}
          onCancel={closeUpload}
          onFileChange={(file) => void handleFile(file)}
          onProfileNameChange={setProfileName}
          onConfirm={confirmProfile}
        />
      ) : null}

      {showPrivacy ? (
        <PrivacyModal
          onClose={() => setShowPrivacy(false)}
          onGithub={() => window.open(DEANA_GITHUB_URL, "_blank", "noopener,noreferrer")}
        />
      ) : null}

      {reportPendingRemoval ? (
        <RemoveReportModal
          report={reportPendingRemoval}
          isRemoving={isRemovingReport}
          error={removeError}
          onCancel={() => {
            setReportPendingRemoval(null);
            setRemoveError(null);
          }}
          onConfirm={() => void confirmRemoveReport()}
        />
      ) : null}
    </>
  );
}
