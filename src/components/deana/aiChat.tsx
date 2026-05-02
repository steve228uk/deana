import { Children, memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { ExplorerFilters } from "../../lib/explorer";
import {
  buildChatContext,
  CHAT_CONSENT_VERSION,
  extractChatFollowUps,
  formatChatTitle,
  mergeChatFindings,
  normalizeChatFollowUps,
  type ChatContextFinding,
  type ChatFollowUpSuggestion,
  type ChatReportContext,
} from "../../lib/aiChat";
import { searchReportEntriesForChat, type ChatRetrievalResult } from "../../lib/aiRetrieval";
import {
  loadAiConsent,
  loadChatMessages,
  loadChatThreads,
  deleteChatThread,
  loadReportEntriesByIds,
  loadReportEntry,
  loadAiChatNoticeDismissal,
  saveAiConsent,
  saveAiChatNoticeDismissal,
  saveChatMessages,
  saveChatThread,
} from "../../lib/storage";
import type { ChatRetrievalTrace, ChatSearchPlan, ExplorerTab, ProfileMeta, StoredChatMessage, StoredChatThread, StoredReportEntry } from "../../types";
import { FindingInspector } from "./explorer";
import { Icon } from "./ui";

interface ExplorerAiChatProps {
  profile: ProfileMeta;
  currentTab: ExplorerTab;
  filters: ExplorerFilters;
  visibleEntries: StoredReportEntry[];
  selectedEntry: StoredReportEntry | null;
}

const markdownSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "deana"],
  },
};

export type SearchStatus =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "ready"; trace: ChatRetrievalTrace }
  | { status: "error"; message: string };

type ChatPanel =
  | { mode: "findings" }
  | { mode: "inspector"; findingId: string; finding: StoredReportEntry | null; isLoading: boolean; error: string | null };

type ChatFollowUpAction =
  | { kind: "prompt"; title: string; body: string }
  | { kind: "searchMore"; title: string; body: string; trace: ChatRetrievalTrace };

const entryLinkPrefix = "deana://entry/";
const entryLinkPattern = new RegExp(`${entryLinkPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[A-Za-z0-9_%~-]+`, "g");

function makeId(prefix: string): string {
  return `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => "text" in part ? part.text : "")
    .join("");
}

function displayMessageText(message: UIMessage): string {
  const text = messageText(message);
  return message.role === "assistant" ? extractChatFollowUps(text).content : text;
}

export function compactChatMessagesForRequest(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((message) => {
      const text = displayMessageText(message).trim();

      return {
        id: message.id,
        role: message.role,
        parts: text ? [{ type: "text" as const, text }] : [],
      };
    })
    .filter((message) => message.role === "user" || message.parts.length > 0);
}

function messageReasoning(message: UIMessage): string | null {
  const text = message.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => "text" in part ? part.text : "")
    .join("")
    .trim();

  return text || null;
}

function messageModel(message: UIMessage): string | null {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const candidate = "model" in metadata ? metadata.model : null;
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function toUiMessages(messages: StoredChatMessage[]): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: "text", text: message.content }],
  }));
}

function threadTitleFromPrompt(prompt: string): string {
  const title = prompt.replace(/\s+/g, " ").trim();
  if (!title) return "New chat";
  return title.length > 52 ? `${title.slice(0, 49)}...` : title;
}

async function generateThreadTitle(prompt: string): Promise<string | null> {
  const response = await fetch("/api/chat-title", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) return null;
  const body = await response.json() as { title?: unknown };
  return typeof body.title === "string" ? formatChatTitle(body.title) || "New chat" : null;
}


function hasToolPart(message: UIMessage): boolean {
  return message.parts.some((part) => part.type.startsWith("tool-"));
}

function entryIdFromHref(href: string | undefined): string | null {
  if (!href?.startsWith(entryLinkPrefix)) return null;
  return decodeURIComponent(href.slice(entryLinkPrefix.length));
}

function linkedEntryIdsFromTextValues(values: string[]): string[] {
  const ids = new Set<string>();
  values.forEach((value) => {
    for (const match of value.matchAll(entryLinkPattern)) {
      const entryId = entryIdFromHref(match[0]);
      if (entryId) ids.add(entryId);
    }
  });
  return Array.from(ids).sort();
}

function textFromChildren(children: ReactNode): string {
  let text = "";
  Children.forEach(children, (child) => {
    if (typeof child === "string" || typeof child === "number") text += child;
  });
  return text;
}

function entryChipLabel(href: string, children: ReactNode, entryTitleById: Map<string, string>): ReactNode {
  const entryId = entryIdFromHref(href);
  const title = entryId ? entryTitleById.get(entryId) : null;
  const childText = textFromChildren(children).trim();
  if (title && (!childText || childText === href)) return title;
  if (childText === href) return "Finding";
  return children;
}

function EntryChip({
  href,
  children,
  entryTitleById,
  onOpenEntry,
}: {
  href: string;
  children: ReactNode;
  entryTitleById: Map<string, string>;
  onOpenEntry: (href: string) => void;
}) {
  return (
    <button className="dn-ai-entry-chip" type="button" onClick={() => onOpenEntry(href)}>
      {entryChipLabel(href, children, entryTitleById)}
    </button>
  );
}

function buildEntryTitleById({
  resolvedEntryTitles,
  selectedEntry,
  visibleEntries,
  retrievedFindings,
  messageFindings,
  traces,
  activeTrace,
}: {
  resolvedEntryTitles: Record<string, string>;
  selectedEntry: StoredReportEntry | null;
  visibleEntries: StoredReportEntry[];
  retrievedFindings: ChatContextFinding[];
  messageFindings: ChatContextFinding[][];
  traces: ChatRetrievalTrace[];
  activeTrace?: ChatRetrievalTrace;
}): Map<string, string> {
  const titles = new Map<string, string>();
  const addTitle = (id: string, title: string) => {
    if (!titles.has(id) && title.trim()) titles.set(id, title);
  };

  Object.entries(resolvedEntryTitles).forEach(([id, title]) => addTitle(id, title));
  if (selectedEntry) addTitle(selectedEntry.id, selectedEntry.title);
  visibleEntries.forEach((entry) => addTitle(entry.id, entry.title));
  retrievedFindings.forEach((finding) => addTitle(finding.id, finding.title));
  messageFindings.flat().forEach((finding) => addTitle(finding.id, finding.title));
  traces.flatMap((trace) => trace.returnedFindings).forEach((finding) => addTitle(finding.id, finding.title));
  activeTrace?.returnedFindings.forEach((finding) => addTitle(finding.id, finding.title));

  return titles;
}

function restoredContextFindings(messages: StoredChatMessage[]): ChatContextFinding[] {
  return mergeChatFindings(
    messages
      .slice()
      .reverse()
      .flatMap((message) => message.contextFindings ?? []),
  );
}

export function searchMoreFollowUpFromTrace(trace: ChatRetrievalTrace | undefined): ChatFollowUpSuggestion | null {
  if (!trace?.retrievalCursor?.hasMore || !trace.searchPlan) return null;
  const label = trace.searchPlan.query.trim() || "the previous local search";

  return {
    title: "Search more findings",
    body: `Show me more local findings for ${label}.`,
  };
}

function followUpsForMessage(message: UIMessage, storedFollowUps: ChatFollowUpSuggestion[] | undefined): ChatFollowUpSuggestion[] {
  return normalizeChatFollowUps([
    ...(storedFollowUps ?? []),
    ...extractChatFollowUps(messageText(message)).followUps,
  ]);
}

function buildFollowUpActions({
  message,
  storedFollowUps,
  trace,
}: {
  message: UIMessage | null;
  storedFollowUps?: ChatFollowUpSuggestion[];
  trace?: ChatRetrievalTrace;
}): ChatFollowUpAction[] {
  if (!message || message.role !== "assistant") return [];
  const actions: ChatFollowUpAction[] = [];
  const seenBodies = new Set<string>();
  const searchMore = searchMoreFollowUpFromTrace(trace);

  if (searchMore && trace) {
    actions.push({ kind: "searchMore", trace, ...searchMore });
    seenBodies.add(searchMore.body.toLocaleLowerCase());
  }

  for (const followUp of followUpsForMessage(message, storedFollowUps)) {
    const key = followUp.body.toLocaleLowerCase();
    if (seenBodies.has(key)) continue;
    seenBodies.add(key);
    actions.push({ kind: "prompt", ...followUp });
  }

  return actions.slice(0, 4);
}

export function ExplorerAiChat(props: ExplorerAiChatProps) {
  const latestPropsRef = useRef(props);
  const latestFindingsRef = useRef<ChatReportContext["findings"]>([]);
  const traceByMessageRef = useRef<Record<string, ChatRetrievalTrace>>({});
  const contextFindingsByMessageRef = useRef<Record<string, ChatContextFinding[]>>({});
  const createdAtByMessageRef = useRef<Record<string, string>>({});
  const reasoningByMessageRef = useRef<Record<string, string>>({});
  const followUpsByMessageRef = useRef<Record<string, ChatFollowUpSuggestion[]>>({});
  const pendingTraceRef = useRef<ChatRetrievalTrace | null>(null);
  const pendingFindingsRef = useRef<ChatContextFinding[] | null>(null);
  const activeThreadRef = useRef<StoredChatThread | null>(null);
  const isActiveThreadSavedRef = useRef(false);
  const pendingSendRef = useRef<string | null>(null);
  const [hasConsented, setHasConsented] = useState(false);
  const [threads, setThreads] = useState<StoredChatThread[]>([]);
  const [activeThread, setActiveThread] = useState<StoredChatThread | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus>({ status: "idle" });
  const [isLoadingMoreFindings, setIsLoadingMoreFindings] = useState(false);
  const [isThreadListOpen, setIsThreadListOpen] = useState(true);
  const [isThreadPanelCollapsed, setIsThreadPanelCollapsed] = useState(false);
  const [modal, setModal] = useState<"chatPrivacy" | null>(null);
  const [isThreadPrivacyNoteVisible, setIsThreadPrivacyNoteVisible] = useState(true);
  const [threadPendingRemoval, setThreadPendingRemoval] = useState<StoredChatThread | null>(null);
  const [isDeletingThread, setIsDeletingThread] = useState(false);
  const [deleteThreadError, setDeleteThreadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<ChatPanel | null>(null);
  const [resolvedEntryTitles, setResolvedEntryTitles] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const setMessagesRef = useRef<((messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])) => void) | null>(null);
  const attemptedEntryTitleIdsRef = useRef<Set<string>>(new Set());
  const entryTitleByIdRef = useRef<Map<string, string>>(new Map());
  const openEntryPanelRef = useRef<(href: string | undefined) => void | Promise<void>>(() => undefined);
  latestPropsRef.current = props;
  activeThreadRef.current = activeThread;

  useEffect(() => {
    attemptedEntryTitleIdsRef.current.clear();
    setResolvedEntryTitles({});
  }, [props.profile.id]);

  useEffect(() => {
    let isMounted = true;

    async function loadState() {
      const consent = await loadAiConsent(props.profile.id);
      if (!isMounted) return;
      const hasValidConsent = consent?.version === CHAT_CONSENT_VERSION;
      setHasConsented(hasValidConsent);
      const noticeDismissedAt = await loadAiChatNoticeDismissal(props.profile.id);
      if (!isMounted) return;
      setIsThreadPrivacyNoteVisible(!noticeDismissedAt);

      const storedThreads = await loadChatThreads(props.profile.id);
      if (!isMounted) return;
      setThreads(storedThreads);
      if (!hasValidConsent) return;
      if (storedThreads[0]) {
        await selectThread(storedThreads[0], false);
      } else {
        startDraftThread({ clearInput: false, focus: false, closeList: false });
      }
    }

    void loadState();
    return () => {
      isMounted = false;
    };
  }, [props.profile.id]);

  async function refreshThreads(selectId?: string) {
    const storedThreads = await loadChatThreads(props.profile.id);
    setThreads(storedThreads);
    const selected = selectId ? storedThreads.find((thread) => thread.id === selectId) : null;
    if (selected) {
      isActiveThreadSavedRef.current = true;
      setActiveThread(selected);
    }
  }

  async function selectThread(thread: StoredChatThread, closeList = true) {
    const storedMessages = await loadChatMessages(thread.id);
    const linkedEntryIds = linkedEntryIdsFromTextValues(storedMessages.map((message) => message.content));
    if (linkedEntryIds.length > 0) {
      try {
        const entries = await loadReportEntriesByIds(latestPropsRef.current.profile.id, linkedEntryIds);
        cacheResolvedEntryTitles(entries);
      } catch {
        // Chat content should still open if optional chip title lookup fails.
      }
    }
    traceByMessageRef.current = Object.fromEntries(
      storedMessages
        .filter((message) => message.trace)
        .map((message) => [message.id, message.trace as ChatRetrievalTrace]),
    );
    contextFindingsByMessageRef.current = Object.fromEntries(
      storedMessages
        .filter((message) => message.contextFindings?.length)
        .map((message) => [message.id, message.contextFindings as ChatContextFinding[]]),
    );
    createdAtByMessageRef.current = Object.fromEntries(storedMessages.map((message) => [message.id, message.createdAt]));
    reasoningByMessageRef.current = Object.fromEntries(
      storedMessages
        .filter((message) => message.reasoningSummary)
        .map((message) => [message.id, message.reasoningSummary as string]),
    );
    followUpsByMessageRef.current = Object.fromEntries(
      storedMessages
        .filter((message) => message.followUps?.length)
        .map((message) => [message.id, normalizeChatFollowUps(message.followUps)]),
    );
    latestFindingsRef.current = restoredContextFindings(storedMessages);
    pendingTraceRef.current = null;
    pendingFindingsRef.current = null;
    setIsLoadingMoreFindings(false);
    activeThreadRef.current = thread;
    isActiveThreadSavedRef.current = true;
    setPanel(null);
    setActiveThread(thread);
    const uiMessages = toUiMessages(storedMessages);
    setInitialMessages(uiMessages);
    setMessagesRef.current?.(uiMessages);
    setSearchStatus({ status: "idle" });
    setInput("");
    if (closeList) setIsThreadListOpen(false);
  }

  function makeThread(prompt?: string): StoredChatThread {
    const now = new Date().toISOString();
    return {
      id: makeId("thread"),
      profileId: props.profile.id,
      title: prompt ? threadTitleFromPrompt(prompt) : "New chat",
      createdAt: now,
      updatedAt: now,
    };
  }

  function focusComposerSoon() {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function startDraftThread({
    clearInput = true,
    focus = true,
    closeList = true,
  }: {
    clearInput?: boolean;
    focus?: boolean;
    closeList?: boolean;
  } = {}): StoredChatThread {
    const currentThread = activeThreadRef.current;
    if (currentThread && !isActiveThreadSavedRef.current && messages.length === 0) {
      if (clearInput) setInput("");
      if (closeList) setIsThreadListOpen(false);
      if (focus) focusComposerSoon();
      return currentThread;
    }

    const thread = makeThread();
    activeThreadRef.current = thread;
    isActiveThreadSavedRef.current = false;
    traceByMessageRef.current = {};
    contextFindingsByMessageRef.current = {};
    createdAtByMessageRef.current = {};
    reasoningByMessageRef.current = {};
    followUpsByMessageRef.current = {};
    latestFindingsRef.current = [];
    pendingTraceRef.current = null;
    pendingFindingsRef.current = null;
    setIsLoadingMoreFindings(false);
    setInitialMessages([]);
    setMessagesRef.current?.([]);
    setSearchStatus({ status: "idle" });
    if (clearInput) setInput("");
    setPanel(null);
    setActiveThread(thread);
    if (closeList) setIsThreadListOpen(false);
    if (focus) focusComposerSoon();
    return thread;
  }

  function startThreadTitleFromFirstPrompt(thread: StoredChatThread, prompt: string): StoredChatThread {
    const now = new Date().toISOString();
    const fallbackThread = {
      ...thread,
      title: threadTitleFromPrompt(prompt),
      updatedAt: now,
    };
    activeThreadRef.current = fallbackThread;
    setActiveThread(fallbackThread);

    void (async () => {
      const generatedTitlePromise = generateThreadTitle(prompt).catch(() => null);

      try {
        await saveChatThread(fallbackThread);
        isActiveThreadSavedRef.current = true;
        await refreshThreads(fallbackThread.id);
        const generatedTitle = await generatedTitlePromise;
        if (!generatedTitle || activeThreadRef.current?.id !== fallbackThread.id) return;
        const titledThread = {
          ...fallbackThread,
          title: generatedTitle,
          updatedAt: new Date().toISOString(),
        };
        activeThreadRef.current = titledThread;
        setActiveThread(titledThread);
        await saveChatThread(titledThread);
        isActiveThreadSavedRef.current = true;
        await refreshThreads(titledThread.id);
      } catch {
        // Keep the local fallback title if remote title generation is unavailable.
      }
    })();

    return fallbackThread;
  }

  async function acceptConsent() {
    await saveAiConsent(props.profile.id, {
      accepted: true,
      version: CHAT_CONSENT_VERSION,
      acceptedAt: new Date().toISOString(),
    });
    setHasConsented(true);
    if (!activeThreadRef.current) {
      const storedThreads = threads.length > 0 ? threads : await loadChatThreads(props.profile.id);
      if (storedThreads.length > 0) {
        setThreads(storedThreads);
        await selectThread(storedThreads[0], false);
      } else {
        startDraftThread();
      }
    }
  }

  async function dismissThreadPrivacyNote() {
    setIsThreadPrivacyNoteVisible(false);
    await saveAiChatNoticeDismissal(props.profile.id, new Date().toISOString());
  }

  function storedMessagesFromUi(messages: UIMessage[], assistantMessage?: UIMessage): StoredChatMessage[] {
    const knownTimes = Object.values(createdAtByMessageRef.current)
      .map((value) => Date.parse(value))
      .filter(Number.isFinite);
    let nextCreatedAtTime = Math.max(Date.now(), ...knownTimes) + 1;
    const assistantParsed = assistantMessage ? extractChatFollowUps(messageText(assistantMessage)) : null;
    const assistantText = assistantParsed?.content.trim() ?? "";
    const assistantTrace = assistantMessage && assistantText && pendingTraceRef.current ? pendingTraceRef.current : null;
    const assistantFindings = assistantMessage && assistantText && pendingFindingsRef.current ? pendingFindingsRef.current : null;
    const assistantReasoning = assistantMessage ? messageReasoning(assistantMessage) : null;
    const assistantFollowUps = assistantParsed ? normalizeChatFollowUps(assistantParsed.followUps) : [];

    return messages
      .filter((message) => {
        if (message.role === "user") return true;
        if (message.role !== "assistant") return false;
        return Boolean(displayMessageText(message).trim() || messageReasoning(message) || traceByMessageRef.current[message.id] || contextFindingsByMessageRef.current[message.id]?.length);
      })
      .map((message) => {
        const parsedMessage = message.role === "assistant" ? extractChatFollowUps(messageText(message)) : null;
        const content = parsedMessage?.content ?? messageText(message);
        const existingCreatedAt = createdAtByMessageRef.current[message.id];
        const createdAt = existingCreatedAt ?? new Date(nextCreatedAtTime++).toISOString();
        createdAtByMessageRef.current[message.id] = createdAt;
        const trace = message.id === assistantMessage?.id && assistantTrace ? assistantTrace : traceByMessageRef.current[message.id];
        const contextFindings = message.id === assistantMessage?.id && assistantFindings ? assistantFindings : contextFindingsByMessageRef.current[message.id];
        const followUps = message.id === assistantMessage?.id && assistantFollowUps.length > 0
          ? assistantFollowUps
          : followUpsByMessageRef.current[message.id];
        if (trace) traceByMessageRef.current[message.id] = trace;
        if (contextFindings?.length) contextFindingsByMessageRef.current[message.id] = contextFindings;
        if (message.id === assistantMessage?.id && assistantReasoning) reasoningByMessageRef.current[message.id] = assistantReasoning;
        if (followUps?.length) followUpsByMessageRef.current[message.id] = followUps;

        return {
          id: message.id,
          threadId: activeThreadRef.current?.id ?? "",
          profileId: props.profile.id,
          role: message.role as "user" | "assistant",
          content,
          createdAt,
          trace,
          contextFindings,
          reasoningSummary: message.id === assistantMessage?.id ? assistantReasoning : null,
          followUps,
        };
      });
  }

  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
    prepareSendMessagesRequest: async ({ api, messages, body }) => {
      return {
        api,
        body: {
          ...body,
          consent: {
            accepted: true,
            version: CHAT_CONSENT_VERSION,
          },
          context: buildChatContext({ ...latestPropsRef.current, retrievedFindings: latestFindingsRef.current }),
          messages: compactChatMessagesForRequest(messages),
        },
      };
    },
  }), []);

  const {
    messages,
    sendMessage,
    stop,
    status,
    error,
    clearError,
    addToolOutput,
    setMessages,
  } = useChat({
    id: activeThread?.id,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      if (toolCall.dynamic || toolCall.toolName !== "searchReportFindings") return;

      setSearchStatus({ status: "searching" });

      try {
        const plan = toolCall.input as ChatSearchPlan;
        const retrieval = await searchReportEntriesForChat({
          profileId: latestPropsRef.current.profile.id,
          prompt: plan.query,
          plan,
        });
        applyChatRetrieval(retrieval);
        void addToolOutput({
          tool: "searchReportFindings",
          toolCallId: toolCall.toolCallId,
          output: {
            findings: retrieval.findings,
            trace: retrieval.trace,
            resultCount: retrieval.resultCount,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI report search is unavailable right now.";
        setSearchStatus({ status: "error", message });
        void addToolOutput({
          tool: "searchReportFindings",
          toolCallId: toolCall.toolCallId,
          state: "output-error",
          errorText: message,
        });
      }
    },
    onFinish: async ({ message, messages: finishedMessages }) => {
      const thread = activeThreadRef.current;
      if (!thread) return;
      if (message.role === "assistant" && hasToolPart(message) && !displayMessageText(message).trim()) return;
      const now = new Date().toISOString();
      const nextThread = {
        ...thread,
        updatedAt: now,
      };
      await saveChatThread(nextThread);
      isActiveThreadSavedRef.current = true;
      await saveChatMessages(thread.id, storedMessagesFromUi(finishedMessages, message));
      pendingTraceRef.current = null;
      pendingFindingsRef.current = null;
      setActiveThread(nextThread);
      await refreshThreads(thread.id);
    },
  });
  setMessagesRef.current = setMessages;
  const isBusy = status === "submitted" || status === "streaming";
  const messageScrollSignal = useMemo(() => messages
    .map((message) => {
      const text = messageText(message);
      const reasoning = messageReasoning(message) ?? "";
      return `${message.id}:${message.role}:${text.length}:${reasoning.length}`;
    })
    .join("|"), [messages]);

  useEffect(() => {
    const pendingText = pendingSendRef.current;
    if (!pendingText || !activeThread) return;
    pendingSendRef.current = null;
    void sendPreparedMessage(pendingText);
  }, [activeThread?.id]);

  useEffect(() => {
    const node = messagesRef.current;
    if (!node) return;
    const frameId = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [messageScrollSignal, status, searchStatus.status, error?.message]);

  function applyChatRetrieval(retrieval: ChatRetrievalResult) {
    latestFindingsRef.current = mergeChatFindings([
      ...retrieval.findings,
      ...latestFindingsRef.current,
    ]);
    pendingTraceRef.current = retrieval.trace;
    pendingFindingsRef.current = latestFindingsRef.current;
    setSearchStatus({ status: "ready", trace: retrieval.trace });
  }

  async function handleShowMoreFindings(trace: ChatRetrievalTrace, followUpPrompt?: string) {
    const cursor = trace.retrievalCursor;
    const plan = trace.searchPlan;
    if (!cursor?.hasMore || !plan || isBusy || isLoadingMoreFindings) return;

    setIsLoadingMoreFindings(true);
    setSearchStatus({ status: "searching" });

    try {
      const retrieval = await searchReportEntriesForChat({
        profileId: latestPropsRef.current.profile.id,
        prompt: plan.query,
        plan,
        excludeIds: cursor.sentFindingIds,
        offset: cursor.nextOffset,
      });

      if (retrieval.findings.length === 0) {
        setSearchStatus({ status: "error", message: "No additional local findings matched that search." });
        return;
      }

      applyChatRetrieval(retrieval);
      setPanel({ mode: "findings" });

      const label = plan.query.trim() || "the previous local search";
      await sendMessage({ text: followUpPrompt ?? `Show me more local findings for ${label}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not retrieve more local findings.";
      setSearchStatus({ status: "error", message });
    } finally {
      setIsLoadingMoreFindings(false);
    }
  }

  function resizeInput() {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
  }

  useEffect(() => {
    resizeInput();
  }, [input]);

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendInputMessage();
  }

  async function sendInputMessage() {
    const text = input.trim();
    if (!text || !hasConsented || isBusy) return;
    let thread = activeThreadRef.current;
    if (!thread) {
      pendingSendRef.current = text;
      startDraftThread({ clearInput: false, focus: false });
      setInput("");
      return;
    }
    setInput("");
    await sendPreparedMessage(text);
  }

  async function sendPreparedMessage(text: string) {
    let thread = activeThreadRef.current;
    if (!thread || isBusy) return;
    const isFirstPrompt = !isActiveThreadSavedRef.current && messages.length === 0;
    if (isFirstPrompt) {
      thread = startThreadTitleFromFirstPrompt(thread, text);
    }
    setIsThreadListOpen(false);
    await sendMessage({ text });
  }

  async function sendFollowUp(action: ChatFollowUpAction) {
    if (isBusy) return;
    clearError();
    if (action.kind === "searchMore") {
      await handleShowMoreFindings(action.trace, action.body);
      return;
    }
    await sendPreparedMessage(action.body);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void sendInputMessage();
  }

  async function confirmDeleteThread() {
    if (!threadPendingRemoval) return;
    setIsDeletingThread(true);
    setDeleteThreadError(null);

    try {
      await deleteChatThread(threadPendingRemoval.id);
      const deletedActiveThread = activeThreadRef.current?.id === threadPendingRemoval.id;
      setThreadPendingRemoval(null);
      const remainingThreads = await loadChatThreads(props.profile.id);
      setThreads(remainingThreads);
      if (deletedActiveThread) {
        const nextThread = remainingThreads[0] ?? null;
        if (nextThread) {
          await selectThread(nextThread, false);
        } else {
          startDraftThread({ focus: false, closeList: false });
        }
      }
    } catch (nextError) {
      setDeleteThreadError(nextError instanceof Error ? nextError.message : "Could not delete this chat.");
    } finally {
      setIsDeletingThread(false);
    }
  }

  const cacheResolvedEntryTitles = useCallback((entries: StoredReportEntry[]) => {
    setResolvedEntryTitles((current) => {
      let changed = false;
      const next = { ...current };
      entries.forEach((entry) => {
        if (entry.title && !next[entry.id]) {
          next[entry.id] = entry.title;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, []);

  const loadChatEntry = useCallback(async (entryId: string): Promise<StoredReportEntry | null> => {
    const entry = await loadReportEntry(latestPropsRef.current.profile.id, entryId);
    if (entry) cacheResolvedEntryTitles([entry]);
    return entry;
  }, [cacheResolvedEntryTitles]);

  const openEntryPanel = useCallback(async (href: string | undefined) => {
    const entryId = entryIdFromHref(href);
    if (!entryId) return;
    setPanel({ mode: "inspector", findingId: entryId, finding: null, isLoading: true, error: null });
    const finding = await loadChatEntry(entryId);
    setPanel({
      mode: "inspector",
      findingId: entryId,
      finding,
      isLoading: false,
      error: finding ? null : "This finding is no longer available in the saved report.",
    });
  }, [loadChatEntry]);
  openEntryPanelRef.current = openEntryPanel;

  const openFindingsPanel = useCallback(() => {
    setPanel({ mode: "findings" });
  }, []);

  const linkedEntryIds = useMemo(() => {
    return linkedEntryIdsFromTextValues(messages.map(displayMessageText));
  }, [messages]);

  const entryTitleById = useMemo(() => {
    return buildEntryTitleById({
      resolvedEntryTitles,
      selectedEntry: props.selectedEntry,
      visibleEntries: props.visibleEntries,
      retrievedFindings: latestFindingsRef.current,
      messageFindings: Object.values(contextFindingsByMessageRef.current),
      traces: Object.values(traceByMessageRef.current),
      activeTrace: searchStatus.status === "ready" ? searchStatus.trace : undefined,
    });
  }, [messages, props.selectedEntry, props.visibleEntries, resolvedEntryTitles, searchStatus]);
  entryTitleByIdRef.current = entryTitleById;

  useEffect(() => {
    const missingEntryIds = linkedEntryIds.filter((entryId) => !entryTitleById.has(entryId) && !attemptedEntryTitleIdsRef.current.has(entryId));
    if (missingEntryIds.length === 0) return;

    missingEntryIds.forEach((entryId) => attemptedEntryTitleIdsRef.current.add(entryId));
    let isMounted = true;

    async function loadLinkedEntryTitles() {
      const entries = await loadReportEntriesByIds(latestPropsRef.current.profile.id, missingEntryIds);
      if (!isMounted) return;
      cacheResolvedEntryTitles(entries);
    }

    void loadLinkedEntryTitles();
    return () => {
      isMounted = false;
    };
  }, [cacheResolvedEntryTitles, entryTitleById, linkedEntryIds]);

  const markdownComponents: Components = useMemo(() => ({
    a({ href, children }) {
      if (entryIdFromHref(href)) {
        return (
          <EntryChip href={href ?? ""} entryTitleById={entryTitleByIdRef.current} onOpenEntry={(entryHref) => void openEntryPanelRef.current(entryHref)}>
            {children}
          </EntryChip>
        );
      }

      if (!href?.startsWith("https://")) {
        return <>{children}</>;
      }

      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
    text({ children }) {
      const value = String(children);
      const nodes: Array<string | JSX.Element> = [];
      let lastIndex = 0;

      for (const match of value.matchAll(entryLinkPattern)) {
        const href = match[0];
        const index = match.index ?? 0;
        if (index > lastIndex) nodes.push(value.slice(lastIndex, index));
        nodes.push(
          <EntryChip key={`${href}-${index}`} href={href} entryTitleById={entryTitleByIdRef.current} onOpenEntry={(entryHref) => void openEntryPanelRef.current(entryHref)}>
            {href}
          </EntryChip>,
        );
        lastIndex = index + href.length;
      }

      if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
      return nodes.length > 0 ? <>{nodes}</> : <>{children}</>;
    },
  }), []);

  const handleOpenEntry = useCallback(
    (entryId: string) => void openEntryPanel(`deana://entry/${encodeURIComponent(entryId)}`),
    [],
  );
  const latestAssistantMessage = messages
    .slice()
    .reverse()
    .find((message) => message.role === "assistant" && displayMessageText(message).trim()) ?? null;
  const latestAssistantTrace = latestAssistantMessage ? traceByMessageRef.current[latestAssistantMessage.id] : undefined;
  const followUpActions = isBusy ? [] : buildFollowUpActions({
    message: latestAssistantMessage,
    storedFollowUps: latestAssistantMessage ? followUpsByMessageRef.current[latestAssistantMessage.id] : undefined,
    trace: latestAssistantTrace,
  });

  return (
    <section
      className={`dn-ai-screen ${isThreadPanelCollapsed ? "is-thread-collapsed" : ""} ${hasConsented ? "" : "is-consent-pending"}`}
      aria-labelledby="ai-chat-title"
    >
      <h1 id="ai-chat-title" className="dn-screen-reader-text">AI chat</h1>
      {hasConsented ? (
        <ThreadList
          threads={threads}
          activeThreadId={activeThread?.id ?? null}
          isOpen={isThreadListOpen}
          isCollapsed={isThreadPanelCollapsed}
          onNewThread={() => startDraftThread()}
          onSelect={(thread) => void selectThread(thread)}
          onCollapse={() => setIsThreadPanelCollapsed(true)}
          onExpand={() => setIsThreadPanelCollapsed(false)}
          isPrivacyNoteVisible={isThreadPrivacyNoteVisible}
          onDismissPrivacyNote={() => void dismissThreadPrivacyNote()}
          onOpenPrivacyInfo={() => setModal("chatPrivacy")}
          onDelete={(thread) => {
            setDeleteThreadError(null);
            setThreadPendingRemoval(thread);
          }}
        />
      ) : null}
      <section className={`dn-ai-chat-pane ${!hasConsented || !isThreadListOpen ? "is-open" : ""}`}>
        {hasConsented ? (
          <header className="dn-ai-panel__header">
            <button className="dn-button dn-button--secondary dn-ai-back" type="button" onClick={() => setIsThreadListOpen(true)}>
              <Icon name="chevronLeft" /> Threads
            </button>
          </header>
        ) : null}

        {!hasConsented ? (
          <AiConsent onAccept={() => void acceptConsent()} />
        ) : (
          <>
            <div className="dn-ai-messages" ref={messagesRef} aria-live="polite">
              {messages.length === 0 ? (
                <div className="dn-ai-empty">
                  <span className="dn-ai-empty__icon" aria-hidden="true">
                    <Icon name="spark" />
                  </span>
                  <h2>Ask Deana about this report</h2>
                  <p>Deana can answer from the current report context and search saved findings when it needs more detail.</p>
                  <button className="dn-button dn-button--secondary" type="button" onClick={() => setModal("chatPrivacy")}>
                    Learn more
                  </button>
                </div>
              ) : null}
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  role={message.role}
                  content={displayMessageText(message)}
                  modelName={messageModel(message)}
                  trace={traceByMessageRef.current[message.id]}
                  interpretedFindingCount={contextFindingsByMessageRef.current[message.id]?.length}
                  reasoningSummary={messageReasoning(message) ?? reasoningByMessageRef.current[message.id] ?? null}
                  entryTitleById={entryTitleById}
                  components={markdownComponents}
                  onOpenEntry={handleOpenEntry}
                  onOpenFindings={openFindingsPanel}
                />
              ))}
              {isBusy ? <GeneratingStatus status={searchStatus} /> : null}
              {error ? (
                <div className="dn-ai-error" role="alert">
                  <Icon name="alert" />
                  <span>{error.message || "AI chat is unavailable right now."}</span>
                </div>
              ) : null}
            </div>
            <form className="dn-ai-form" onSubmit={submitMessage}>
              {followUpActions.length > 0 ? (
                <FollowUpSuggestions followUps={followUpActions} onSelect={(action) => void sendFollowUp(action)} />
              ) : null}
              <div className="dn-ai-composer">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => {
                    clearError();
                    setInput(event.target.value);
                  }}
                  onKeyDown={handleComposerKeyDown}
                  maxLength={2_000}
                  rows={1}
                  placeholder="Ask about anything in this report..."
                  aria-label="Message Deana AI"
                  disabled={isBusy}
                />
                {isBusy ? (
                  <button className="dn-ai-send-button dn-ai-send-button--stop" type="button" aria-label="Stop generating" onClick={stop}>
                    <Icon name="stop" />
                  </button>
                ) : (
                  <button className="dn-ai-send-button" type="submit" aria-label="Send message" disabled={!input.trim()}>
                    <Icon name="send" />
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </section>
      {panel ? (
        <ChatSidePanel
          panel={panel}
          traces={Object.values(traceByMessageRef.current)}
          searchStatus={searchStatus}
          onClose={() => setPanel(null)}
          onBack={() => setPanel({ mode: "findings" })}
          onOpenEntry={handleOpenEntry}
          onShowMoreFindings={handleShowMoreFindings}
          isLoadingMoreFindings={isLoadingMoreFindings}
        />
      ) : null}
      {modal === "chatPrivacy" ? <ChatPrivacyModal onClose={() => setModal(null)} /> : null}
      {threadPendingRemoval ? (
        <RemoveChatModal
          thread={threadPendingRemoval}
          isRemoving={isDeletingThread}
          error={deleteThreadError}
          onCancel={() => {
            setThreadPendingRemoval(null);
            setDeleteThreadError(null);
          }}
          onConfirm={() => void confirmDeleteThread()}
        />
      ) : null}
    </section>
  );
}

function FollowUpSuggestions({
  followUps,
  onSelect,
}: {
  followUps: ChatFollowUpAction[];
  onSelect: (action: ChatFollowUpAction) => void;
}) {
  return (
    <div className="dn-ai-follow-ups" aria-label="Suggested follow-up prompts">
      {followUps.map((followUp) => (
        <button key={`${followUp.kind}-${followUp.body}`} type="button" onClick={() => onSelect(followUp)} title={followUp.body}>
          {followUp.kind === "searchMore" ? <Icon name="search" /> : <Icon name="spark" />}
          <span>{followUp.title}</span>
        </button>
      ))}
    </div>
  );
}

function ThreadList({
  threads,
  activeThreadId,
  isOpen,
  isCollapsed,
  isPrivacyNoteVisible,
  onNewThread,
  onSelect,
  onCollapse,
  onExpand,
  onDismissPrivacyNote,
  onOpenPrivacyInfo,
  onDelete,
}: {
  threads: StoredChatThread[];
  activeThreadId: string | null;
  isOpen: boolean;
  isCollapsed: boolean;
  isPrivacyNoteVisible: boolean;
  onNewThread: () => void;
  onSelect: (thread: StoredChatThread) => void;
  onCollapse: () => void;
  onExpand: () => void;
  onDismissPrivacyNote: () => void;
  onOpenPrivacyInfo: () => void;
  onDelete: (thread: StoredChatThread) => void;
}) {
  return (
    <aside className={`dn-ai-thread-list ${isOpen ? "is-open" : ""} ${isCollapsed ? "is-collapsed" : ""}`} aria-label="AI chat threads">
      {isCollapsed ? (
        <button
          className="dn-ai-thread-rail-button"
          aria-label="Expand chats"
          aria-expanded="false"
          onClick={onExpand}
        >
          <Icon name="chat" />
          <span>Chats</span>
          <Icon name="chevronRight" size={16} />
        </button>
      ) : (
        <>
      <div className="dn-ai-thread-list__header">
        <div className="dn-ai-thread-list__title">
          <button
            className="dn-icon-button dn-ai-thread-collapse"
            aria-label="Collapse chats"
            aria-expanded="true"
            type="button"
            onClick={onCollapse}
          >
            <Icon name="chevronLeft" />
          </button>
          <h2>Chats</h2>
        </div>
        <button className="dn-icon-button dn-ai-compose-button" type="button" onClick={onNewThread} aria-label="New chat">
          <Icon name="compose" />
        </button>
      </div>
      <div className="dn-ai-thread-list__items">
        {threads.length === 0 ? <p>No chats yet.</p> : null}
        {threads.map((thread) => (
          <div className={`dn-ai-thread ${thread.id === activeThreadId ? "is-active" : ""}`} key={thread.id}>
            <button type="button" onClick={() => onSelect(thread)}>
              <strong>{thread.title}</strong>
              <span>{new Date(thread.updatedAt).toLocaleDateString()}</span>
            </button>
            <button className="dn-icon-button dn-ai-thread__delete" type="button" aria-label={`Delete chat ${thread.title}`} onClick={() => onDelete(thread)}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
      {isPrivacyNoteVisible ? (
        <div className="dn-ai-thread-note">
          <button className="dn-icon-button dn-ai-thread-note__close" type="button" aria-label="Dismiss AI chat note" onClick={onDismissPrivacyNote}>
            <Icon name="x" />
          </button>
          <Icon name="alert" />
          <p>
            AI chat uses Vercel AI Gateway.
            <button type="button" onClick={onOpenPrivacyInfo}>Learn more</button>
          </p>
        </div>
      ) : null}
        </>
      )}
    </aside>
  );
}

export function generatingStatusDetail(status: SearchStatus): string {
  if (status.status === "searching") return "Searching saved report findings...";
  if (status.status === "ready") return `Interpreting ${status.trace.resultCount} matched findings...`;
  if (status.status === "error") return status.message;
  return "Thinking…";
}

function findingCountLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "finding" : "findings"}`;
}

export function traceFindingSummary(trace: ChatRetrievalTrace, interpretedFindingCount?: number): string {
  const interpretedCount = interpretedFindingCount ?? trace.sentCount ?? trace.resultCount;
  const remainingCount = trace.remainingCandidateCount ?? 0;
  const interpretedLabel = `${findingCountLabel(interpretedCount)} interpreted`;

  if (remainingCount > 0) {
    return `${interpretedLabel} · ${remainingCount.toLocaleString()} remaining`;
  }

  return interpretedLabel;
}

function GeneratingStatus({ status }: { status: SearchStatus }) {
  const detail = generatingStatusDetail(status);

  return (
    <div className="dn-ai-status">
      <span className="dn-ai-status-spinner" aria-hidden="true" />
      <span>{detail}</span>
    </div>
  );
}

function ChatPrivacyModal({ onClose }: { onClose: () => void }) {
  const points = [
    ["alert", "AI chat leaves this browser", "Your message and compact report context are sent to Vercel AI Gateway and the routed model provider after you opt in."],
    ["shield", "Raw DNA stays local", "Raw DNA files, full marker lists, profile names, and file names are not included in chat requests."],
    ["search", "Findings are searched locally", "Deana sends compact report context first and searches saved findings in this browser only when more context is needed."],
    ["lock", "History is local", "Consent and chat history are stored in this browser for this report and can be removed by deleting chats or the report."],
  ] as const;

  return (
    <div className="dn-modal-backdrop" role="presentation">
      <section className="dn-modal dn-privacy-modal" role="dialog" aria-modal="true" aria-labelledby="chat-privacy-title">
        <button className="dn-icon-button dn-modal-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        <h1 id="chat-privacy-title">How AI chat works</h1>
        <p className="dn-modal-intro">Chat is optional and uses only selected report context needed to answer your question.</p>
        <div className="dn-privacy-point-list">
          {points.map(([icon, title, copy], index) => (
            <article className="dn-privacy-point" key={title}>
              <span className="dn-round-icon"><Icon name={icon} /></span>
              <div>
                <h2>{index + 1}. {title}</h2>
                <p>{copy}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="dn-modal-actions">
          <button className="dn-button dn-button--primary" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

function RemoveChatModal({
  thread,
  isRemoving,
  error,
  onCancel,
  onConfirm,
}: {
  thread: StoredChatThread;
  isRemoving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dn-modal-backdrop" role="presentation">
      <section className="dn-modal dn-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-chat-title">
        <button className="dn-icon-button dn-modal-close" disabled={isRemoving} onClick={onCancel} aria-label="Close"><Icon name="x" /></button>
        <span className="dn-round-icon"><Icon name="alert" /></span>
        <h1 id="remove-chat-title">Remove this chat?</h1>
        <p className="dn-modal-intro">
          This will remove <strong>{thread.title}</strong> and its saved messages from this browser.
        </p>
        <div className="dn-modal-actions">
          <button className="dn-button dn-button--secondary" disabled={isRemoving} onClick={onCancel}>Cancel</button>
          <button className="dn-button dn-button--coral" disabled={isRemoving} onClick={onConfirm}>
            {isRemoving ? "Removing..." : "Remove chat"}
          </button>
        </div>
        {error ? <p className="dn-error-text" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}

function AiConsent({ onAccept }: { onAccept: () => void }) {
  const points = [
    ["shield", "Zero data retention is requested", "Requests are sent through Vercel AI Gateway with zero data retention enabled for the gateway call."],
    ["alert", "Selected report context leaves this browser", "Chat text, selected markers, genotypes, matched findings, source names, and source links may be sent to answer your question."],
    ["lock", "Raw DNA stays local", "Raw DNA files, full marker lists, profile names, and file names are not included. Consent and chat history stay in this browser."],
  ] as const;

  return (
    <section className="dn-ai-consent">
      <span className="dn-ai-empty__icon dn-ai-consent__icon" aria-hidden="true">
        <Icon name="alert" />
      </span>
      <p className="dn-eyebrow">Optional AI chat</p>
      <h2>AI chat sends report context off this device</h2>
      <p className="dn-ai-consent__intro">
        Deana can answer questions about this report, but chat is not fully local. Continue only if you are comfortable sending limited report context through Vercel AI Gateway and the routed model provider.
      </p>
      <div className="dn-ai-consent__points">
        {points.map(([icon, title, copy]) => (
          <article className="dn-privacy-point" key={title}>
            <span className="dn-round-icon"><Icon name={icon} /></span>
            <div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </div>
          </article>
        ))}
      </div>
      <button className="dn-button dn-button--primary" type="button" onClick={onAccept}>
        I understand
      </button>
    </section>
  );
}

function ChatSidePanel({
  panel,
  traces,
  searchStatus,
  onClose,
  onBack,
  onOpenEntry,
  onShowMoreFindings,
  isLoadingMoreFindings,
}: {
  panel: ChatPanel;
  traces: ChatRetrievalTrace[];
  searchStatus: SearchStatus;
  onClose: () => void;
  onBack: () => void;
  onOpenEntry: (entryId: string) => void;
  onShowMoreFindings: (trace: ChatRetrievalTrace) => void;
  isLoadingMoreFindings: boolean;
}) {
  const effectiveTraces = searchStatus.status === "ready"
    ? [...traces.filter((trace) => trace.searchedAt !== searchStatus.trace.searchedAt), searchStatus.trace]
    : traces;
  const latestTrace = effectiveTraces[effectiveTraces.length - 1] ?? null;
  const findings = effectiveTraces.flatMap((trace) => trace.returnedFindings);
  const uniqueFindings = Array.from(new Map(findings.map((finding) => [finding.id, finding])).values());

  return (
    <aside className={`dn-ai-side-panel ${panel.mode === "inspector" ? "is-inspector" : ""}`} aria-label={panel.mode === "findings" ? "Chat findings" : "Chat inspector"}>
      <div className="dn-ai-side-panel__header">
        {panel.mode === "inspector" ? (
          <button className="dn-button dn-button--secondary" type="button" onClick={onBack}>
            <Icon name="chevronLeft" /> Back
          </button>
        ) : <h2>Findings</h2>}
        <button className="dn-icon-button" type="button" aria-label="Close panel" onClick={onClose}><Icon name="x" /></button>
      </div>

      {panel.mode === "findings" ? (
        <div className="dn-ai-findings-panel">
          {latestTrace ? (
            <>
              <section>
                <p className="dn-eyebrow">Search summary</p>
                <h3>Searched {latestTrace.scannedCategories.join(", ")}</h3>
                <p>{latestTrace.rationale}</p>
                <dl>
                  <div><dt>Sent</dt><dd>{(latestTrace.sentCount ?? latestTrace.resultCount).toLocaleString()} findings</dd></div>
                  <div><dt>Considered</dt><dd>{(latestTrace.candidateWindowCount ?? latestTrace.indexCandidateCount ?? latestTrace.resultCount).toLocaleString()} local matches</dd></div>
                  <div><dt>Remaining</dt><dd>{(latestTrace.remainingCandidateCount ?? 0).toLocaleString()} in this local window</dd></div>
                  <div><dt>Terms</dt><dd>{latestTrace.searchedTerms.length > 0 ? latestTrace.searchedTerms.slice(0, 16).join(", ") : "Prompt terms only"}</dd></div>
                  <div><dt>Related</dt><dd>{latestTrace.relatedTerms.length > 0 ? latestTrace.relatedTerms.slice(0, 12).join(", ") : "None returned"}</dd></div>
                </dl>
                {latestTrace.retrievalCursor?.hasMore ? (
                  <button className="dn-button dn-button--primary dn-ai-show-more-button" type="button" onClick={() => onShowMoreFindings(latestTrace)} disabled={isLoadingMoreFindings}>
                    <Icon name="search" /> {isLoadingMoreFindings ? "Finding more..." : "Show more findings"}
                  </button>
                ) : null}
              </section>
              <section>
                <p className="dn-eyebrow">Sent to AI</p>
                <div className="dn-ai-finding-list">
                  {uniqueFindings.length > 0 ? uniqueFindings.map((finding) => (
                    <button key={finding.id} type="button" onClick={() => onOpenEntry(finding.id)}>
                      <strong>{finding.title}</strong>
                      <span>{finding.category} · {finding.matchedFields.length > 0 ? finding.matchedFields.join(", ") : "ranked result"}</span>
                    </button>
                  )) : <p>No saved findings were sent for this search.</p>}
                </div>
              </section>
            </>
          ) : (
            <p className="dn-ai-panel-empty">No report findings have been searched in this chat yet.</p>
          )}
        </div>
      ) : (
        <FindingInspector
          finding={panel.finding}
          emptyTitle={panel.isLoading ? "Loading finding" : "Finding unavailable"}
          emptyContent={
            panel.isLoading ? (
              <p className="dn-ai-panel-empty">Loading finding...</p>
            ) : panel.error ? (
              <div className="dn-ai-error" role="alert"><Icon name="alert" /> {panel.error}</div>
            ) : undefined
          }
        />
      )}
    </aside>
  );
}


const remarkPlugins = [remarkGfm] as Parameters<typeof ReactMarkdown>[0]["remarkPlugins"] & object;
const rehypePlugins = [[rehypeSanitize, markdownSchema]] as Parameters<typeof ReactMarkdown>[0]["rehypePlugins"] & object;

const ChatMessage = memo(function ChatMessage({
  role,
  content,
  modelName,
  trace,
  interpretedFindingCount,
  reasoningSummary,
  entryTitleById,
  components,
  onOpenEntry,
  onOpenFindings,
}: {
  role: UIMessage["role"];
  content: string;
  modelName: string | null;
  trace?: ChatRetrievalTrace;
  interpretedFindingCount?: number;
  reasoningSummary: string | null;
  entryTitleById: Map<string, string>;
  components: Components;
  onOpenEntry: (entryId: string) => void;
  onOpenFindings: () => void;
}) {
  void entryTitleById;
  const hasReasoning = Boolean(reasoningSummary?.trim());

  if (!content && !hasReasoning) return null;

  return (
    <article className={`dn-ai-message dn-ai-message--${role}`}>
      {role === "assistant" && modelName ? <p className="dn-ai-model-name">Model: {modelName}</p> : null}
      {hasReasoning && role === "assistant" ? <ModelReasoning reasoning={reasoningSummary ?? ""} /> : null}
      {content ? (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
          urlTransform={(url) => url}
        >
          {content}
        </ReactMarkdown>
      ) : null}
      {role === "assistant" && trace ? (
        <TracePanel trace={trace} interpretedFindingCount={interpretedFindingCount} onOpenFindings={onOpenFindings} />
      ) : null}
    </article>
  );
});

function ModelReasoning({ reasoning }: { reasoning: string }) {
  return (
    <details className="dn-ai-trace dn-ai-trace--reasoning" open>
      <summary><Icon name="spark" /> Model reasoning</summary>
      <div className="dn-ai-trace__body">
        <p>{reasoning}</p>
      </div>
    </details>
  );
}

function TracePanel({
  trace,
  interpretedFindingCount,
  onOpenFindings,
}: {
  trace: ChatRetrievalTrace;
  interpretedFindingCount?: number;
  onOpenFindings: () => void;
}) {
  return (
    <button className="dn-ai-findings-button" type="button" onClick={onOpenFindings}>
      <Icon name="search" />
      {traceFindingSummary(trace, interpretedFindingCount)}
    </button>
  );
}
