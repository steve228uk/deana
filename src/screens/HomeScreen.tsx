import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DEANA_GITHUB_URL,
  MarketingFirstVisit,
  MarketingReturning,
  PrivacyModal,
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
      setProfileName(file.name.replace(/\.[^.]+$/, ""));
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

  function scrollHowItWorks() {
    document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const reportCards = profiles.map(toReportCard);

  return (
    <>
      {!isLibraryReady || profiles.length === 0 ? (
        <MarketingFirstVisit
          onUpload={openUpload}
          onPrivacy={() => setShowPrivacy(true)}
          onHowItWorks={scrollHowItWorks}
        />
      ) : (
        <MarketingReturning
          reports={reportCards}
          onCreateNew={openUpload}
          onOpenReport={(id) => navigate(`/explorer/${id}?tab=overview`)}
          onRemoveReport={(id) => void removeProfile(id)}
          onPrivacy={() => setShowPrivacy(true)}
          onHowItWorks={scrollHowItWorks}
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
    </>
  );
}
