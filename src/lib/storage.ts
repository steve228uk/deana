import { EVIDENCE_PACK_VERSION } from "./evidencePack";
import { DEFAULT_FILTERS, ExplorerFilters, buildEntrySearchText, matchesEntryFilters } from "./explorer";
import { generateReport, REPORT_VERSION } from "./reportEngine";
import {
  ExplorerPage,
  ParsedDnaFile,
  ProfileMeta,
  ProfileSupplements,
  ReportEntryKind,
  ReportDataMeta,
  SavedProfile,
  SavedProfileSummary,
  StoredReportEntry,
} from "../types";

const DB_NAME = "deana-local";
const LEGACY_STORE = "profiles";
const PROFILE_META_STORE = "profile_meta";
const PROFILE_DNA_STORE = "profile_dna";
const REPORT_ENTRY_STORE = "report_entries";
const DB_VERSION = 3;
const PAGE_SIZE = 50;

const ENTRY_PROFILE_INDEX = "profileId";
const ENTRY_CATEGORY_ID_INDEX = "profileCategoryId";
const ENTRY_SEVERITY_INDEX = "profileCategorySeverity";
const ENTRY_EVIDENCE_INDEX = "profileCategoryEvidence";
const ENTRY_PUBLICATIONS_INDEX = "profileCategoryPublications";
const ENTRY_ALPHABETICAL_INDEX = "profileCategoryAlphabetical";

type SortIndexName =
  | typeof ENTRY_SEVERITY_INDEX
  | typeof ENTRY_EVIDENCE_INDEX
  | typeof ENTRY_PUBLICATIONS_INDEX
  | typeof ENTRY_ALPHABETICAL_INDEX;

interface StoredProfileMetaRecord extends Omit<ProfileMeta, "dna" | "supplements"> {
  dna: SavedProfileSummary["dna"];
  supplements?: ProfileSupplements;
}

interface StoredProfileDnaRecord {
  id: string;
  dna: ParsedDnaFile;
}

interface PageCursorPayload {
  indexKey: IDBValidKey;
  primaryKey: IDBValidKey;
  totalLoaded: number;
}

interface CategoryPageRequest {
  profileId: string;
  category: StoredReportEntry["category"];
  filters: ExplorerFilters;
  cursor?: string | null;
  pageSize?: number;
  entryKinds?: ReportEntryKind[];
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const transaction = request.transaction;

      if (!transaction) {
        return;
      }

      if (!db.objectStoreNames.contains(PROFILE_META_STORE)) {
        db.createObjectStore(PROFILE_META_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(PROFILE_DNA_STORE)) {
        db.createObjectStore(PROFILE_DNA_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(REPORT_ENTRY_STORE)) {
        const entryStore = db.createObjectStore(REPORT_ENTRY_STORE, { keyPath: ["profileId", "id"] });
        entryStore.createIndex(ENTRY_PROFILE_INDEX, "profileId", { unique: false });
        entryStore.createIndex(ENTRY_CATEGORY_ID_INDEX, ["profileId", "category", "id"], { unique: false });
        entryStore.createIndex(ENTRY_SEVERITY_INDEX, ["profileId", "category", "sort.severity", "id"], { unique: false });
        entryStore.createIndex(ENTRY_EVIDENCE_INDEX, ["profileId", "category", "sort.evidence", "id"], { unique: false });
        entryStore.createIndex(ENTRY_PUBLICATIONS_INDEX, ["profileId", "category", "sort.publications", "id"], { unique: false });
        entryStore.createIndex(ENTRY_ALPHABETICAL_INDEX, ["profileId", "category", "sort.alphabetical", "id"], {
          unique: false,
        });
      }

      if (event.oldVersion > 0 && db.objectStoreNames.contains(LEGACY_STORE)) {
        migrateLegacyProfiles(transaction);
      }

      if (event.oldVersion > 0 && event.oldVersion < 3 && db.objectStoreNames.contains(PROFILE_META_STORE)) {
        stripStoredProfileMetadata(transaction);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function hasCurrentReportShape(profile: SavedProfile): boolean {
  return Boolean(
    profile.report?.entries?.every((entry) => entry.entryKind && entry.outcome && entry.normalizedClinicalSignificance !== undefined) &&
      !profile.report?.tabs?.some((tab) => (tab.tab as string) === "other") &&
      profile.report?.facets?.clinicalSignificanceLabels &&
      typeof profile.report?.overview?.localEvidenceEntryMatches === "number" &&
      typeof profile.report?.overview?.localEvidenceRecordMatches === "number" &&
      typeof profile.report?.overview?.localEvidenceMatchedRsids === "number",
  );
}

function profileNeedsRegeneration(profile: {
  reportVersion: number;
  evidencePackVersion: string;
  report: Pick<ReportDataMeta, "reportVersion" | "evidencePackVersion">;
}): boolean {
  return (
    profile.reportVersion !== REPORT_VERSION ||
    profile.evidencePackVersion !== EVIDENCE_PACK_VERSION ||
    profile.report.reportVersion !== REPORT_VERSION ||
    profile.report.evidencePackVersion !== EVIDENCE_PACK_VERSION
  );
}

export function stripProfileSupplementsForMetaStorage(
  supplements?: ProfileSupplements,
): ProfileSupplements | undefined {
  if (!supplements?.evidence) return undefined;

  return {
    evidence: {
      ...supplements.evidence,
      matchedRecords: [],
    },
  };
}

function supplementsForRegeneration(profile: SavedProfile): ProfileSupplements | undefined {
  const supplements = profile.supplements;
  const evidence = supplements?.evidence;
  if (!evidence) return supplements;

  if (
    evidence.status === "complete" &&
    evidence.matchedRecords.length === 0 &&
    (profile.report?.overview?.localEvidenceRecordMatches ?? 0) > 0
  ) {
    return undefined;
  }

  return supplements;
}

export function ensureCurrentProfile(profile: SavedProfile): SavedProfile {
  if (
    !profileNeedsRegeneration(profile) &&
    profile.report?.entries &&
    profile.report?.tabs &&
    hasCurrentReportShape(profile)
  ) {
    return profile;
  }

  const supplements = supplementsForRegeneration(profile);

  return {
    ...profile,
    supplements,
    reportVersion: REPORT_VERSION,
    evidencePackVersion: EVIDENCE_PACK_VERSION,
    report: generateReport(profile.dna, supplements),
  };
}

function toReportMeta(report: SavedProfile["report"]): ReportDataMeta {
  return {
    reportVersion: report.reportVersion,
    evidencePackVersion: report.evidencePackVersion,
    overview: report.overview,
    tabs: report.tabs,
    facets: report.facets,
  };
}

function toStoredProfileMeta(profile: SavedProfile): StoredProfileMetaRecord {
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
    supplements: stripProfileSupplementsForMetaStorage(profile.supplements),
    reportVersion: profile.reportVersion,
    evidencePackVersion: profile.evidencePackVersion,
    report: toReportMeta(profile.report),
  };
}

function stripStoredProfileMetadata(transaction: IDBTransaction) {
  const metaStore = transaction.objectStore(PROFILE_META_STORE);
  const request = metaStore.openCursor();

  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;

    const value = cursor.value as StoredProfileMetaRecord;
    metaStore.put({
      ...value,
      supplements: stripProfileSupplementsForMetaStorage(value.supplements),
    });
    cursor.continue();
  };
}

function toStoredProfileDna(profile: SavedProfile): StoredProfileDnaRecord {
  return {
    id: profile.id,
    dna: profile.dna,
  };
}

function toStoredReportEntries(profile: SavedProfile): StoredReportEntry[] {
  return profile.report.entries.map((entry) => ({
    ...entry,
    profileId: profile.id,
    searchText: buildEntrySearchText(entry),
  }));
}

function sortSummaries(records: StoredProfileMetaRecord[]): SavedProfileSummary[] {
  return records
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((record) => ({
      id: record.id,
      name: record.name,
      fileName: record.fileName,
      createdAt: record.createdAt,
      dna: record.dna,
      reportVersion: record.reportVersion,
      evidencePackVersion: record.evidencePackVersion,
      report: {
        overview: record.report.overview,
      },
    }));
}

function encodeCursor(cursor: PageCursorPayload): string {
  return JSON.stringify(cursor);
}

function decodeCursor(value: string | null | undefined): PageCursorPayload | null {
  if (!value) return null;

  try {
    return JSON.parse(value) as PageCursorPayload;
  } catch {
    return null;
  }
}

function indexForSort(sort: ExplorerFilters["sort"]): { name: SortIndexName; direction: IDBCursorDirection } {
  switch (sort) {
    case "alphabetical":
      return { name: ENTRY_ALPHABETICAL_INDEX, direction: "next" };
    case "publications":
      return { name: ENTRY_PUBLICATIONS_INDEX, direction: "prev" };
    case "evidence":
      return { name: ENTRY_EVIDENCE_INDEX, direction: "prev" };
    case "severity":
    default:
      return { name: ENTRY_SEVERITY_INDEX, direction: "prev" };
  }
}

function openSortCursor(
  store: IDBObjectStore,
  profileId: string,
  category: StoredReportEntry["category"],
  sort: ExplorerFilters["sort"],
): IDBRequest<IDBCursorWithValue | null> {
  const { name, direction } = indexForSort(sort);
  const index = store.index(name);
  const lower =
    name === ENTRY_ALPHABETICAL_INDEX
      ? [profileId, category, "", ""]
      : [profileId, category, -1_000_000_000, ""];
  const upper =
    name === ENTRY_ALPHABETICAL_INDEX
      ? [profileId, category, "\uffff", "\uffff"]
      : [profileId, category, 1_000_000_000, "\uffff"];

  return index.openCursor(IDBKeyRange.bound(lower, upper), direction);
}

function matchesStoredEntry(
  entry: StoredReportEntry,
  filters: ExplorerFilters,
  entryKinds?: ReportEntryKind[],
): boolean {
  return (!entryKinds || entryKinds.includes(entry.entryKind)) && matchesEntryFilters(entry, filters, entry.category);
}

function deleteEntriesForProfile(store: IDBObjectStore, profileId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.only(profileId);
    const request = store.index(ENTRY_PROFILE_INDEX).openKeyCursor(range);

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      store.delete(cursor.primaryKey);
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

function writeNormalizedProfile(transaction: IDBTransaction, profile: SavedProfile): Promise<void> {
  const metaStore = transaction.objectStore(PROFILE_META_STORE);
  const dnaStore = transaction.objectStore(PROFILE_DNA_STORE);
  const entryStore = transaction.objectStore(REPORT_ENTRY_STORE);

  metaStore.put(toStoredProfileMeta(profile));
  dnaStore.put(toStoredProfileDna(profile));

  return deleteEntriesForProfile(entryStore, profile.id).then(() => {
    for (const entry of toStoredReportEntries(profile)) {
      entryStore.put(entry);
    }
  });
}

function migrateLegacyProfiles(transaction: IDBTransaction) {
  const legacyStore = transaction.objectStore(LEGACY_STORE);
  const metaStore = transaction.objectStore(PROFILE_META_STORE);
  const dnaStore = transaction.objectStore(PROFILE_DNA_STORE);
  const entryStore = transaction.objectStore(REPORT_ENTRY_STORE);
  const request = legacyStore.openCursor();

  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      legacyStore.clear();
      return;
    }

    const profile = ensureCurrentProfile(cursor.value as SavedProfile);
    metaStore.put(toStoredProfileMeta(profile));
    dnaStore.put(toStoredProfileDna(profile));

    for (const entry of toStoredReportEntries(profile)) {
      entryStore.put(entry);
    }

    cursor.continue();
  };
}

export async function loadProfileSummaries(): Promise<SavedProfileSummary[]> {
  const db = await openDb();
  const transaction = db.transaction(PROFILE_META_STORE, "readonly");
  const records = await requestToPromise(transaction.objectStore(PROFILE_META_STORE).getAll() as IDBRequest<StoredProfileMetaRecord[]>);
  return sortSummaries(records);
}

export const loadProfiles = loadProfileSummaries;

export async function loadProfileMeta(profileId: string): Promise<ProfileMeta | null> {
  const db = await openDb();
  const transaction = db.transaction([PROFILE_META_STORE, PROFILE_DNA_STORE], "readonly");
  const metaRecord = await requestToPromise(
    transaction.objectStore(PROFILE_META_STORE).get(profileId) as IDBRequest<StoredProfileMetaRecord | undefined>,
  );
  const dnaRecord = await requestToPromise(
    transaction.objectStore(PROFILE_DNA_STORE).get(profileId) as IDBRequest<StoredProfileDnaRecord | undefined>,
  );

  if (!metaRecord || !dnaRecord) {
    return null;
  }

  const profile = {
    ...metaRecord,
    dna: dnaRecord.dna,
  };

  if (profileNeedsRegeneration(profile)) {
    const refreshed = ensureCurrentProfile(profile as SavedProfile);
    await saveProfile(refreshed);
    return {
      ...toStoredProfileMeta(refreshed),
      dna: refreshed.dna,
    };
  }

  return profile;
}

export async function loadCategoryPage({
  profileId,
  category,
  filters,
  cursor,
  pageSize = PAGE_SIZE,
  entryKinds,
}: CategoryPageRequest): Promise<ExplorerPage> {
  const db = await openDb();
  const transaction = db.transaction(REPORT_ENTRY_STORE, "readonly");
  const store = transaction.objectStore(REPORT_ENTRY_STORE);
  const request = openSortCursor(store, profileId, category, filters.sort);
  const resume = decodeCursor(cursor);

  return new Promise((resolve, reject) => {
    const entries: StoredReportEntry[] = [];
    let hasMore = false;
    let nextCursor: string | null = null;
    let lastReturnedCursor: PageCursorPayload | null = null;
    let resumed = !resume;

    request.onsuccess = () => {
      const cursorResult = request.result;
      if (!cursorResult) {
        resolve({
          entries,
          nextCursor,
          totalLoaded: (resume?.totalLoaded ?? 0) + entries.length,
          hasMore,
        });
        return;
      }

      if (!resumed && resume) {
        resumed = true;
        cursorResult.continuePrimaryKey(resume.indexKey, resume.primaryKey);
        return;
      }

      const value = cursorResult.value as StoredReportEntry;
      if (matchesStoredEntry(value, filters, entryKinds)) {
        if (entries.length < pageSize) {
          entries.push(value);
          lastReturnedCursor = {
            indexKey: cursorResult.key,
            primaryKey: cursorResult.primaryKey,
            totalLoaded: (resume?.totalLoaded ?? 0) + entries.length,
          };
        } else {
          hasMore = true;
          nextCursor = lastReturnedCursor ? encodeCursor(lastReturnedCursor) : null;
          resolve({
            entries,
            nextCursor,
            totalLoaded: (resume?.totalLoaded ?? 0) + entries.length,
            hasMore,
          });
          return;
        }
      }

      cursorResult.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

export async function loadReportEntry(profileId: string, entryId: string): Promise<StoredReportEntry | null> {
  const db = await openDb();
  const transaction = db.transaction(REPORT_ENTRY_STORE, "readonly");
  const entry = await requestToPromise(
    transaction.objectStore(REPORT_ENTRY_STORE).get([profileId, entryId]) as IDBRequest<StoredReportEntry | undefined>,
  );
  return entry ?? null;
}

async function loadAllEntriesForCategory(
  profileId: string,
  category: StoredReportEntry["category"],
): Promise<StoredReportEntry[]> {
  const entries: StoredReportEntry[] = [];
  let cursor: string | null = null;

  do {
    const page = await loadCategoryPage({
      profileId,
      category,
      filters: DEFAULT_FILTERS,
      cursor,
    });
    entries.push(...page.entries);
    cursor = page.nextCursor;
  } while (cursor);

  return entries;
}

export async function* streamReportEntries(
  profileId: string,
  category?: StoredReportEntry["category"],
): AsyncGenerator<StoredReportEntry> {
  const categories = category ? [category] : (["medical", "traits", "drug"] as const);

  for (const activeCategory of categories) {
    const entries = await loadAllEntriesForCategory(profileId, activeCategory);
    for (const entry of entries) {
      yield entry;
    }
  }
}

export async function saveProfile(profile: SavedProfile): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction([PROFILE_META_STORE, PROFILE_DNA_STORE, REPORT_ENTRY_STORE], "readwrite");
  const done = transactionToPromise(transaction);
  await writeNormalizedProfile(transaction, ensureCurrentProfile(profile));
  await done;
}

export async function deleteProfile(id: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction([PROFILE_META_STORE, PROFILE_DNA_STORE, REPORT_ENTRY_STORE], "readwrite");
  const done = transactionToPromise(transaction);
  const metaStore = transaction.objectStore(PROFILE_META_STORE);
  const dnaStore = transaction.objectStore(PROFILE_DNA_STORE);
  const entryStore = transaction.objectStore(REPORT_ENTRY_STORE);

  metaStore.delete(id);
  dnaStore.delete(id);
  await deleteEntriesForProfile(entryStore, id);
  await done;
}

export { DB_NAME, DB_VERSION };
