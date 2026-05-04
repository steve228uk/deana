import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { MarketingProcessing, PrivacyModal } from "../components/deana/marketing";
import { EvidenceProgressSnapshot, ParsedDnaFile, SavedProfileSummary } from "../types";

export interface PendingProfileBuild {
  name: string;
  parsed: ParsedDnaFile;
}

interface ProcessingScreenProps {
  pendingBuild: PendingProfileBuild | null;
  createProfile: (
    name: string,
    parsed: ParsedDnaFile,
    onProgress?: (snapshot: EvidenceProgressSnapshot) => void,
  ) => Promise<SavedProfileSummary>;
  refreshProfileEvidence: (
    profileId: string,
    onProgress?: (snapshot: EvidenceProgressSnapshot) => void,
  ) => Promise<SavedProfileSummary>;
  clearPendingBuild: () => void;
}

function initialSnapshot(markerCount: number, currentRsid: string): EvidenceProgressSnapshot {
  return {
    status: "running",
    totalRsids: markerCount,
    processedRsids: 0,
    matchedFindings: 0,
    unmatchedRsids: 0,
    failedRsids: 0,
    retries: 0,
    currentRsid,
  };
}

function initialSnapshotForProcessing(
  pendingBuild: PendingProfileBuild | null,
  refreshProfileId: string | undefined,
): EvidenceProgressSnapshot | null {
  if (pendingBuild) {
    return initialSnapshot(pendingBuild.parsed.markerCount, "Preparing bundled evidence sources");
  }
  if (refreshProfileId) {
    return initialSnapshot(0, "Loading saved report");
  }
  return null;
}

export function ProcessingScreen({
  pendingBuild,
  createProfile,
  refreshProfileEvidence,
  clearPendingBuild,
}: ProcessingScreenProps) {
  const navigate = useNavigate();
  const { profileId: refreshProfileId } = useParams<{ profileId: string }>();
  const startedRef = useRef(false);
  const [snapshot, setSnapshot] = useState<EvidenceProgressSnapshot | null>(() =>
    initialSnapshotForProcessing(pendingBuild, refreshProfileId),
  );
  const [error, setError] = useState<string | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (refreshProfileId) {
      void refreshProfileEvidence(refreshProfileId, setSnapshot)
        .then((profile) => {
          navigate(`/explorer/${profile.id}?tab=overview`, { replace: true });
        })
        .catch(() => {
          setError("Evidence refresh failed. Your existing report was left unchanged.");
        });
      return;
    }

    if (!pendingBuild) return;

    void createProfile(pendingBuild.name, pendingBuild.parsed, setSnapshot)
      .then((profile) => {
        clearPendingBuild();
        navigate(`/explorer/${profile.id}?tab=overview`, { replace: true });
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Report processing failed.");
      });
  }, [clearPendingBuild, createProfile, navigate, pendingBuild, refreshProfileEvidence, refreshProfileId]);

  if ((!pendingBuild && !refreshProfileId) || !snapshot) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <MarketingProcessing
        snapshot={snapshot}
        error={error}
        mode={refreshProfileId ? "refresh" : "create"}
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
