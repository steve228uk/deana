import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { MarketingProcessing, PrivacyModal } from "../components/deana/marketing";
import { ParsedDnaFile, SavedProfileSummary, SnpediaProgressSnapshot } from "../types";

export interface PendingProfileBuild {
  name: string;
  parsed: ParsedDnaFile;
}

interface ProcessingScreenProps {
  pendingBuild: PendingProfileBuild | null;
  createProfile: (
    name: string,
    parsed: ParsedDnaFile,
    onProgress?: (snapshot: SnpediaProgressSnapshot) => void,
  ) => Promise<SavedProfileSummary>;
  clearPendingBuild: () => void;
}

function initialSnapshot(parsed: ParsedDnaFile): SnpediaProgressSnapshot {
  return {
    status: "running",
    totalRsids: parsed.markerCount,
    processedRsids: 0,
    matchedFindings: 0,
    unmatchedRsids: 0,
    failedRsids: 0,
    retries: 0,
    currentRsid: null,
  };
}

export function ProcessingScreen({
  pendingBuild,
  createProfile,
  clearPendingBuild,
}: ProcessingScreenProps) {
  const navigate = useNavigate();
  const startedRef = useRef(false);
  const [snapshot, setSnapshot] = useState<SnpediaProgressSnapshot | null>(
    pendingBuild ? initialSnapshot(pendingBuild.parsed) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);

  useEffect(() => {
    if (!pendingBuild || startedRef.current) return;
    startedRef.current = true;

    void createProfile(pendingBuild.name, pendingBuild.parsed, setSnapshot)
      .then((profile) => {
        clearPendingBuild();
        navigate(`/explorer/${profile.id}?tab=overview`, { replace: true });
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Report processing failed.");
      });
  }, [clearPendingBuild, createProfile, navigate, pendingBuild]);

  if (!pendingBuild || !snapshot) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <MarketingProcessing
        snapshot={snapshot}
        error={error}
        onPrivacy={() => setShowPrivacy(true)}
        onBackHome={() => {
          clearPendingBuild();
          navigate("/", { replace: true });
        }}
      />
      {showPrivacy ? <PrivacyModal onClose={() => setShowPrivacy(false)} /> : null}
    </>
  );
}
