import { EVIDENCE_PACK_VERSION } from "./evidencePack";
import { DEFAULT_FILTERS, ExplorerFilters, buildEntrySearchText, matchesEntryFilters } from "./explorer";
import { generateReport, REPORT_VERSION } from "./reportEngine";
import {
  ExplorerPage,
  AiConsentAcceptance,
  ParsedDnaFile,
  ProfileMeta,
  ProfileSupplements,
  ReportEntryKind,
  ReportDataMeta,
  SavedProfile,
  SavedProfileSummary,
  StoredAiConsent,
  StoredChatMessage,
  StoredChatThread,
  StoredReportEntry,
} from "../types";

const DB_NAME = "deana-local";
const LEGACY_STORE = "profiles";
const PROFILE_META_STORE = "profile_meta";
const PROFILE_DNA_STORE = "profile_dna";
const REPORT_ENTRY_STORE = "report_entries";
const AI_CONSENT_STORE = "ai_consent";
const AI_CHAT_THREAD_STORE = "ai_chat_threads";
const AI_CHAT_MESSAGE_STORE = "ai_chat_messages";
const SEARCH_INDEX_CACHE_STORE = "search_index_cache";
const DB_VERSION = 7;
const PAGE_SIZE = 50;

const ENTRY_PROFILE_INDEX = "profileId";
const ENTRY_CATEGORY_ID_INDEX = "profileCategoryId";
const ENTRY_RANK_INDEX = "profileCategoryRank";
const ENTRY_SEVERITY_INDEX = "profileCategorySeverity";
const ENTRY_EVIDENCE_INDEX = "profileCategoryEvidence";
const ENTRY_PUBLICATIONS_INDEX = "profileCategoryPublications";
const ENTRY_ALPHABETICAL_INDEX = "profileCategoryAlphabetical";
const CHAT_THREAD_PROFILE_INDEX = "profileId";
const CHAT_THREAD_PROFILE_UPDATED_INDEX = "profileUpdatedAt";
const CHAT_MESSAGE_PROFILE_INDEX = "profileId";
const CHAT_MESSAGE_THREAD_INDEX = "threadId";
const CHAT_MESSAGE_THREAD_CREATED_INDEX = "threadCreatedAt";

type SortIndexName =
  | typeof ENTRY_RANK_INDEX
  | typeof ENTRY_SEVERITY_INDEX
  | typeof ENTRY_EVIDENCE_INDEX
  | typeof ENTRY_PUBLICATIONS_INDEX
  | typeof ENTRY_ALPHABETICAL_INDEX;

const REQUIRED_OBJECT_STORES = [
  PROFILE_META_STORE,
  PROFILE_DNA_STORE,
  REPORT_ENTRY_STORE,
  AI_CONSENT_STORE,
  AI_CHAT_THREAD_STORE,
  AI_CHAT_MESSAGE_STORE,
  SEARCH_INDEX_CACHE_STORE,
] as const;

interface StoredProfileMetaRecord extends Omit<ProfileMeta, "dna" | "supplements"> {
  dna: SavedProfileSummary["dna"];
  supplements?: ProfileSupplements;
}

interface StoredProfileDnaRecord {
  id: string;
  dna: ParsedDnaFile;
}

export interface SearchIndexProfileMetadata {
  reportVersion: number;
  evidencePackVersion: string;
  reportParsedAt: string;
}

export interface StoredSearchIndexCache {
  profileId: string;
  cacheVersion: number;
  reportVersion: number;
  evidencePackVersion: string;
  reportParsedAt: string;
  documentCount: number;
  rawData: unknown;
  cachedAt: string;
}

export interface SearchIndexSource {
  metadata: SearchIndexProfileMetadata;
  entries: StoredReportEntry[];
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

function hasRequiredObjectStores(db: IDBDatabase): boolean {
  return REQUIRED_OBJECT_STORES.every((storeName) => db.objectStoreNames.contains(storeName));
}

function ensureReportEntryIndexes(entryStore: IDBObjectStore): void {
  if (!entryStore.indexNames.contains(ENTRY_PROFILE_INDEX)) {
    entryStore.createIndex(ENTRY_PROFILE_INDEX, "profileId", { unique: false });
  }
  if (!entryStore.indexNames.contains(ENTRY_CATEGORY_ID_INDEX)) {
    entryStore.createIndex(ENTRY_CATEGORY_ID_INDEX, ["profileId", "category", "id"], { unique: false });
  }
  if (!entryStore.indexNames.contains(ENTRY_RANK_INDEX)) {
    entryStore.createIndex(ENTRY_RANK_INDEX, ["profileId", "category", "sort.rank", "sort.severity", "sort.evidence", "id"], {
      unique: false,
    });
  }
  if (!entryStore.indexNames.contains(ENTRY_SEVERITY_INDEX)) {
    entryStore.createIndex(ENTRY_SEVERITY_INDEX, ["profileId", "category", "sort.severity", "id"], { unique: false });
  }
  if (!entryStore.indexNames.contains(ENTRY_EVIDENCE_INDEX)) {
    entryStore.createIndex(ENTRY_EVIDENCE_INDEX, ["profileId", "category", "sort.evidence", "id"], { unique: false });
  }
  if (!entryStore.indexNames.contains(ENTRY_PUBLICATIONS_INDEX)) {
    entryStore.createIndex(ENTRY_PUBLICATIONS_INDEX, ["profileId", "category", "sort.publications", "id"], { unique: false });
  }
  if (!entryStore.indexNames.contains(ENTRY_ALPHABETICAL_INDEX)) {
    entryStore.createIndex(ENTRY_ALPHABETICAL_INDEX, ["profileId", "category", "sort.alphabetical", "id"], {
      unique: false,
    });
  }
}

function openDb(version = DB_VERSION, canRepairMissingStores = true): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);

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
        ensureReportEntryIndexes(entryStore);
      } else if (event.oldVersion > 0 && event.oldVersion < 7) {
        ensureReportEntryIndexes(transaction.objectStore(REPORT_ENTRY_STORE));
      }

      if (!db.objectStoreNames.contains(AI_CONSENT_STORE)) {
        db.createObjectStore(AI_CONSENT_STORE, { keyPath: "profileId" });
      }

      if (!db.objectStoreNames.contains(AI_CHAT_THREAD_STORE)) {
        const threadStore = db.createObjectStore(AI_CHAT_THREAD_STORE, { keyPath: "id" });
        threadStore.createIndex(CHAT_THREAD_PROFILE_INDEX, "profileId", { unique: false });
        threadStore.createIndex(CHAT_THREAD_PROFILE_UPDATED_INDEX, ["profileId", "updatedAt"], { unique: false });
      }

      if (!db.objectStoreNames.contains(AI_CHAT_MESSAGE_STORE)) {
        const messageStore = db.createObjectStore(AI_CHAT_MESSAGE_STORE, { keyPath: "id" });
        messageStore.createIndex(CHAT_MESSAGE_PROFILE_INDEX, "profileId", { unique: false });
        messageStore.createIndex(CHAT_MESSAGE_THREAD_INDEX, "threadId", { unique: false });
        messageStore.createIndex(CHAT_MESSAGE_THREAD_CREATED_INDEX, ["threadId", "createdAt"], { unique: false });
      }

      if (!db.objectStoreNames.contains(SEARCH_INDEX_CACHE_STORE)) {
        db.createObjectStore(SEARCH_INDEX_CACHE_STORE, { keyPath: "profileId" });
      }

      if (event.oldVersion > 0 && db.objectStoreNames.contains(LEGACY_STORE)) {
        migrateLegacyProfiles(transaction);
      }

      if (event.oldVersion > 0 && event.oldVersion < 3 && db.objectStoreNames.contains(PROFILE_META_STORE)) {
        stripStoredProfileMetadata(transaction);
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      if (canRepairMissingStores && !hasRequiredObjectStores(db)) {
        const repairVersion = db.version + 1;
        db.close();
        openDb(repairVersion, false).then(resolve, reject);
        return;
      }

      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

function hasCurrentReportShape(profile: SavedProfile): boolean {
  return Boolean(
    profile.report?.entries?.every((entry) => entry.entryKind && entry.outcome && entry.normalizedClinicalSignificance !== undefined) &&
      profile.report.entries.every((entry) => typeof entry.sort?.rank === "number") &&
      !profile.report?.tabs?.some((tab) => (tab.tab as string) === "other") &&
      profile.report?.facets?.clinicalSignificanceLabels &&
      typeof profile.report?.overview?.localEvidenceEntryMatches === "number" &&
      typeof profile.report?.overview?.localEvidenceRecordMatches === "number" &&
      typeof profile.report?.overview?.localEvidenceMatchedRsids === "number",
  );
}

function profileNeedsReportShapeRegeneration(profile: {
  reportVersion: number;
  report: Pick<ReportDataMeta, "reportVersion">;
}): boolean {
  return (
    profile.reportVersion !== REPORT_VERSION ||
    profile.report.reportVersion !== REPORT_VERSION
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
    !profileNeedsReportShapeRegeneration(profile) &&
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

function toSearchIndexProfileMetadata(meta: StoredProfileMetaRecord): SearchIndexProfileMetadata {
  return {
    reportVersion: meta.reportVersion,
    evidencePackVersion: meta.evidencePackVersion,
    reportParsedAt: meta.report.overview.parsedAt,
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
    case "rank":
      return { name: ENTRY_RANK_INDEX, direction: "prev" };
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
  return deleteByIndex(store, ENTRY_PROFILE_INDEX, profileId);
}

function deleteByIndex(store: IDBObjectStore, indexName: string, value: IDBValidKey | IDBKeyRange): Promise<void> {
  return new Promise((resolve, reject) => {
    const range = value instanceof IDBKeyRange ? value : IDBKeyRange.only(value);
    const request = store.index(indexName).openKeyCursor(range);

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

function replaceMessagesForThread(store: IDBObjectStore, threadId: string, messages: StoredChatMessage[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.index(CHAT_MESSAGE_THREAD_INDEX).openKeyCursor(IDBKeyRange.only(threadId));

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
        return;
      }

      for (const message of messages) {
        store.put(message);
      }
      resolve();
    };

    request.onerror = () => reject(request.error);
  });
}

export function compareStoredChatMessages(left: StoredChatMessage, right: StoredChatMessage): number {
  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) return createdAtComparison;
  if (left.role !== right.role) return left.role === "user" ? -1 : 1;
  return left.id.localeCompare(right.id);
}

function writeNormalizedProfile(transaction: IDBTransaction, profile: SavedProfile): Promise<void> {
  const metaStore = transaction.objectStore(PROFILE_META_STORE);
  const dnaStore = transaction.objectStore(PROFILE_DNA_STORE);
  const entryStore = transaction.objectStore(REPORT_ENTRY_STORE);
  const meta = toStoredProfileMeta(profile);
  const dna = toStoredProfileDna(profile);
  const entries = toStoredReportEntries(profile);

  metaStore.put(meta);
  dnaStore.put(dna);

  return deleteEntriesForProfile(entryStore, profile.id).then(() => {
    for (const entry of entries) {
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

  if (profileNeedsReportShapeRegeneration(profile)) {
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

export async function loadReportEntriesByIds(
  profileId: string,
  ids: string[],
): Promise<StoredReportEntry[]> {
  if (ids.length === 0) return [];
  const db = await openDb();
  const transaction = db.transaction(REPORT_ENTRY_STORE, "readonly");
  const store = transaction.objectStore(REPORT_ENTRY_STORE);
  const entries = await Promise.all(
    ids.map((id) => requestToPromise(store.get([profileId, id]) as IDBRequest<StoredReportEntry | undefined>)),
  );
  return entries.filter((entry): entry is StoredReportEntry => Boolean(entry));
}

function loadReportEntriesForProfile(store: IDBObjectStore, profileId: string): Promise<StoredReportEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: StoredReportEntry[] = [];
    const request = store.index(ENTRY_PROFILE_INDEX).openCursor(IDBKeyRange.only(profileId));

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(entries);
        return;
      }

      entries.push(cursor.value as StoredReportEntry);
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

export async function loadSearchIndexSource(profileId: string): Promise<SearchIndexSource | null> {
  const db = await openDb();
  const transaction = db.transaction([PROFILE_META_STORE, REPORT_ENTRY_STORE], "readonly");
  const metaPromise = requestToPromise(
    transaction.objectStore(PROFILE_META_STORE).get(profileId) as IDBRequest<StoredProfileMetaRecord | undefined>,
  );
  const entriesPromise = loadReportEntriesForProfile(transaction.objectStore(REPORT_ENTRY_STORE), profileId);
  const [meta, entries] = await Promise.all([metaPromise, entriesPromise]);

  if (!meta) return null;

  return {
    metadata: toSearchIndexProfileMetadata(meta),
    entries,
  };
}

export async function loadSearchIndexCache(
  profileId: string,
  cacheVersion: number,
): Promise<StoredSearchIndexCache | null> {
  const db = await openDb();
  const transaction = db.transaction([PROFILE_META_STORE, SEARCH_INDEX_CACHE_STORE], "readonly");
  const [meta, cache] = await Promise.all([
    requestToPromise(transaction.objectStore(PROFILE_META_STORE).get(profileId) as IDBRequest<StoredProfileMetaRecord | undefined>),
    requestToPromise(transaction.objectStore(SEARCH_INDEX_CACHE_STORE).get(profileId) as IDBRequest<StoredSearchIndexCache | undefined>),
  ]);

  if (!meta || !cache || cache.cacheVersion !== cacheVersion) return null;

  const metadata = toSearchIndexProfileMetadata(meta);
  if (
    cache.reportVersion !== metadata.reportVersion ||
    cache.evidencePackVersion !== metadata.evidencePackVersion ||
    cache.reportParsedAt !== metadata.reportParsedAt
  ) {
    return null;
  }

  return cache;
}

export async function saveSearchIndexCache({
  profileId,
  cacheVersion,
  documentCount,
  rawData,
}: {
  profileId: string;
  cacheVersion: number;
  documentCount: number;
  rawData: unknown;
}): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction([PROFILE_META_STORE, SEARCH_INDEX_CACHE_STORE], "readwrite");
  const done = transactionToPromise(transaction);
  const meta = await requestToPromise(
    transaction.objectStore(PROFILE_META_STORE).get(profileId) as IDBRequest<StoredProfileMetaRecord | undefined>,
  );

  if (meta) {
    transaction.objectStore(SEARCH_INDEX_CACHE_STORE).put({
      profileId,
      cacheVersion,
      ...toSearchIndexProfileMetadata(meta),
      documentCount,
      rawData,
      cachedAt: new Date().toISOString(),
    } satisfies StoredSearchIndexCache);
  }

  await done;
}

export async function deleteSearchIndexCache(profileId?: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(SEARCH_INDEX_CACHE_STORE, "readwrite");
  const done = transactionToPromise(transaction);
  if (profileId) {
    transaction.objectStore(SEARCH_INDEX_CACHE_STORE).delete(profileId);
  } else {
    transaction.objectStore(SEARCH_INDEX_CACHE_STORE).clear();
  }
  await done;
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
  const currentProfile = ensureCurrentProfile(profile);
  await writeNormalizedProfile(transaction, currentProfile);
  await done;
}

export async function loadAiConsent(profileId: string): Promise<AiConsentAcceptance | null> {
  const db = await openDb();
  const transaction = db.transaction(AI_CONSENT_STORE, "readonly");
  const record = await requestToPromise(
    transaction.objectStore(AI_CONSENT_STORE).get(profileId) as IDBRequest<StoredAiConsent | undefined>,
  );

  if (!record) return null;
  return {
    accepted: record.accepted,
    version: record.version,
    acceptedAt: record.acceptedAt,
  };
}

export async function saveAiConsent(profileId: string, consent: AiConsentAcceptance): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(AI_CONSENT_STORE, "readwrite");
  const done = transactionToPromise(transaction);
  const existing = await requestToPromise(
    transaction.objectStore(AI_CONSENT_STORE).get(profileId) as IDBRequest<StoredAiConsent | undefined>,
  );
  transaction.objectStore(AI_CONSENT_STORE).put({
    ...existing,
    ...consent,
    profileId,
  } satisfies StoredAiConsent);
  await done;
}

export async function loadAiChatNoticeDismissal(profileId: string): Promise<string | null> {
  const db = await openDb();
  const transaction = db.transaction(AI_CONSENT_STORE, "readonly");
  const record = await requestToPromise(
    transaction.objectStore(AI_CONSENT_STORE).get(profileId) as IDBRequest<StoredAiConsent | undefined>,
  );
  return record?.chatNoticeDismissedAt ?? null;
}

export async function saveAiChatNoticeDismissal(profileId: string, dismissedAt: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(AI_CONSENT_STORE, "readwrite");
  const done = transactionToPromise(transaction);
  const store = transaction.objectStore(AI_CONSENT_STORE);
  const existing = await requestToPromise(store.get(profileId) as IDBRequest<StoredAiConsent | undefined>);
  if (existing) {
    store.put({
      ...existing,
      chatNoticeDismissedAt: dismissedAt,
    } satisfies StoredAiConsent);
  }
  await done;
}

export async function loadChatThreads(profileId: string): Promise<StoredChatThread[]> {
  const db = await openDb();
  const transaction = db.transaction(AI_CHAT_THREAD_STORE, "readonly");
  const request = transaction.objectStore(AI_CHAT_THREAD_STORE)
    .index(CHAT_THREAD_PROFILE_INDEX)
    .getAll(profileId) as IDBRequest<StoredChatThread[]>;
  const records = await requestToPromise(request);

  return records.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveChatThread(thread: StoredChatThread): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(AI_CHAT_THREAD_STORE, "readwrite");
  const done = transactionToPromise(transaction);
  transaction.objectStore(AI_CHAT_THREAD_STORE).put(thread);
  await done;
}

export async function deleteChatThread(threadId: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction([AI_CHAT_THREAD_STORE, AI_CHAT_MESSAGE_STORE], "readwrite");
  const done = transactionToPromise(transaction);
  transaction.objectStore(AI_CHAT_THREAD_STORE).delete(threadId);
  const deleteMessages = deleteByIndex(transaction.objectStore(AI_CHAT_MESSAGE_STORE), CHAT_MESSAGE_THREAD_INDEX, threadId);
  await deleteMessages;
  await done;
}

export async function loadChatMessages(threadId: string): Promise<StoredChatMessage[]> {
  const db = await openDb();
  const transaction = db.transaction(AI_CHAT_MESSAGE_STORE, "readonly");
  const request = transaction.objectStore(AI_CHAT_MESSAGE_STORE)
    .index(CHAT_MESSAGE_THREAD_INDEX)
    .getAll(threadId) as IDBRequest<StoredChatMessage[]>;
  const records = await requestToPromise(request);

  return records.slice().sort(compareStoredChatMessages);
}

export async function saveChatMessages(threadId: string, messages: StoredChatMessage[]): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(AI_CHAT_MESSAGE_STORE, "readwrite");
  const done = transactionToPromise(transaction);
  await replaceMessagesForThread(transaction.objectStore(AI_CHAT_MESSAGE_STORE), threadId, messages);
  await done;
}

export async function deleteProfile(id: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(
    [
      PROFILE_META_STORE,
      PROFILE_DNA_STORE,
      REPORT_ENTRY_STORE,
      AI_CONSENT_STORE,
      AI_CHAT_THREAD_STORE,
      AI_CHAT_MESSAGE_STORE,
      SEARCH_INDEX_CACHE_STORE,
    ],
    "readwrite",
  );
  const done = transactionToPromise(transaction);
  const metaStore = transaction.objectStore(PROFILE_META_STORE);
  const dnaStore = transaction.objectStore(PROFILE_DNA_STORE);
  const entryStore = transaction.objectStore(REPORT_ENTRY_STORE);
  const consentStore = transaction.objectStore(AI_CONSENT_STORE);
  const threadStore = transaction.objectStore(AI_CHAT_THREAD_STORE);
  const messageStore = transaction.objectStore(AI_CHAT_MESSAGE_STORE);
  const searchIndexCacheStore = transaction.objectStore(SEARCH_INDEX_CACHE_STORE);

  metaStore.delete(id);
  dnaStore.delete(id);
  consentStore.delete(id);
  searchIndexCacheStore.delete(id);
  await Promise.all([
    deleteEntriesForProfile(entryStore, id),
    deleteByIndex(threadStore, CHAT_THREAD_PROFILE_INDEX, id),
    deleteByIndex(messageStore, CHAT_MESSAGE_PROFILE_INDEX, id),
  ]);
  await done;
}

export { DB_NAME, DB_VERSION };
