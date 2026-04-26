import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
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
  mergeChatFindings,
  type ChatContextFinding,
  type ChatReportContext,
  type ChatSearchPlan,
} from "../../lib/aiChat";
import { searchReportEntriesForChat } from "../../lib/aiRetrieval";
import {
  loadAiConsent,
  loadChatMessages,
  loadChatThreads,
  deleteChatThread,
  loadReportEntry,
  loadAiChatNoticeDismissal,
  saveAiConsent,
  saveAiChatNoticeDismissal,
  saveChatMessages,
  saveChatThread,
} from "../../lib/storage";
import type { ChatRetrievalTrace, ExplorerTab, ProfileMeta, StoredChatMessage, StoredChatThread, StoredReportEntry } from "../../types";
import { FindingDetailContent } from "./explorer";
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

type SearchStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "searching" }
  | { status: "ready"; trace: ChatRetrievalTrace }
  | { status: "error"; message: string };

type ChatPanel =
  | { mode: "findings" }
  | { mode: "inspector"; findingId: string; finding: StoredReportEntry | null; isLoading: boolean; error: string | null };

const entryLinkPattern = /deana:\/\/entry\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+/g;

function makeId(prefix: string): string {
  return `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => "text" in part ? part.text : "")
    .join("");
}

function messageReasoning(message: UIMessage): string | null {
  const text = message.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => "text" in part ? part.text : "")
    .join("")
    .trim();

  return text || null;
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

function compactAssistantTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "");
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
  return typeof body.title === "string" ? compactAssistantTitle(body.title) : null;
}

function contextForProps({
  profile,
  currentTab,
  filters,
  visibleEntries,
  selectedEntry,
}: ExplorerAiChatProps, retrievedFindings?: ChatReportContext["findings"]): ChatReportContext {
  return buildChatContext({
    profile,
    currentTab,
    filters,
    visibleEntries,
    selectedEntry,
    retrievedFindings,
  });
}

function hasToolPart(message: UIMessage): boolean {
  return message.parts.some((part) => part.type.startsWith("tool-"));
}

function restoredContextFindings(messages: StoredChatMessage[]): ChatContextFinding[] {
  return mergeChatFindings(
    messages
      .slice()
      .reverse()
      .flatMap((message) => message.contextFindings ?? []),
  );
}

export function ExplorerAiChat(props: ExplorerAiChatProps) {
  const latestPropsRef = useRef(props);
  const latestFindingsRef = useRef<ChatReportContext["findings"]>([]);
  const traceByMessageRef = useRef<Record<string, ChatRetrievalTrace>>({});
  const contextFindingsByMessageRef = useRef<Record<string, ChatContextFinding[]>>({});
  const createdAtByMessageRef = useRef<Record<string, string>>({});
  const reasoningByMessageRef = useRef<Record<string, string>>({});
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
  const [isThreadListOpen, setIsThreadListOpen] = useState(true);
  const [isThreadPanelCollapsed, setIsThreadPanelCollapsed] = useState(false);
  const [modal, setModal] = useState<"chatPrivacy" | null>(null);
  const [isThreadPrivacyNoteVisible, setIsThreadPrivacyNoteVisible] = useState(true);
  const [threadPendingRemoval, setThreadPendingRemoval] = useState<StoredChatThread | null>(null);
  const [isDeletingThread, setIsDeletingThread] = useState(false);
  const [deleteThreadError, setDeleteThreadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<ChatPanel | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const setMessagesRef = useRef<((messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])) => void) | null>(null);
  latestPropsRef.current = props;
  activeThreadRef.current = activeThread;

  useEffect(() => {
    let isMounted = true;

    async function loadState() {
      const consent = await loadAiConsent(props.profile.id);
      if (!isMounted) return;
      setHasConsented(consent?.version === CHAT_CONSENT_VERSION);
      const noticeDismissedAt = await loadAiChatNoticeDismissal(props.profile.id);
      if (!isMounted) return;
      setIsThreadPrivacyNoteVisible(!noticeDismissedAt);

      const storedThreads = await loadChatThreads(props.profile.id);
      if (!isMounted) return;
      setThreads(storedThreads);
      if (storedThreads[0]) {
        await selectThread(storedThreads[0], false);
      } else if (consent?.version === CHAT_CONSENT_VERSION) {
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
    latestFindingsRef.current = restoredContextFindings(storedMessages);
    pendingTraceRef.current = null;
    pendingFindingsRef.current = null;
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
    latestFindingsRef.current = [];
    pendingTraceRef.current = null;
    pendingFindingsRef.current = null;
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
      startDraftThread();
    }
  }

  async function dismissThreadPrivacyNote() {
    setIsThreadPrivacyNoteVisible(false);
    await saveAiChatNoticeDismissal(props.profile.id, new Date().toISOString());
  }

  function storedMessagesFromUi(messages: UIMessage[], assistantMessage?: UIMessage): StoredChatMessage[] {
    const now = new Date().toISOString();
    const assistantText = assistantMessage ? messageText(assistantMessage).trim() : "";
    const assistantTrace = assistantMessage && assistantText && pendingTraceRef.current ? pendingTraceRef.current : null;
    const assistantFindings = assistantMessage && assistantText && pendingFindingsRef.current ? pendingFindingsRef.current : null;
    const assistantReasoning = assistantMessage ? messageReasoning(assistantMessage) : null;

    return messages
      .filter((message) => {
        if (message.role === "user") return true;
        if (message.role !== "assistant") return false;
        return Boolean(messageText(message).trim() || messageReasoning(message) || traceByMessageRef.current[message.id] || contextFindingsByMessageRef.current[message.id]?.length);
      })
      .map((message) => {
        const createdAt = createdAtByMessageRef.current[message.id] ?? now;
        createdAtByMessageRef.current[message.id] = createdAt;
        const trace = message.id === assistantMessage?.id && assistantTrace ? assistantTrace : traceByMessageRef.current[message.id];
        const contextFindings = message.id === assistantMessage?.id && assistantFindings ? assistantFindings : contextFindingsByMessageRef.current[message.id];
        if (trace) traceByMessageRef.current[message.id] = trace;
        if (contextFindings?.length) contextFindingsByMessageRef.current[message.id] = contextFindings;
        if (message.id === assistantMessage?.id && assistantReasoning) reasoningByMessageRef.current[message.id] = assistantReasoning;

        return {
          id: message.id,
          threadId: activeThreadRef.current?.id ?? "",
          profileId: props.profile.id,
          role: message.role as "user" | "assistant",
          content: messageText(message),
          createdAt,
          trace,
          contextFindings,
          reasoningSummary: message.id === assistantMessage?.id ? assistantReasoning : null,
        };
      });
  }

  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
    prepareSendMessagesRequest: async ({ api, messages, body }) => {
      setSearchStatus((current) => current.status === "searching" || current.status === "ready" ? current : { status: "checking" });

      return {
        api,
        body: {
          ...body,
          consent: {
            accepted: true,
            version: CHAT_CONSENT_VERSION,
          },
          context: contextForProps(latestPropsRef.current, latestFindingsRef.current),
          messages,
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
        latestFindingsRef.current = mergeChatFindings([
          ...retrieval.findings,
          ...latestFindingsRef.current,
        ]);
        pendingTraceRef.current = retrieval.trace;
        pendingFindingsRef.current = latestFindingsRef.current;
        setSearchStatus({ status: "ready", trace: retrieval.trace });
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
      if (message.role === "assistant" && hasToolPart(message) && !messageText(message).trim()) return;
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
      setSearchStatus((current) => current.status === "checking" ? { status: "idle" } : current);
      setActiveThread(nextThread);
      await refreshThreads(thread.id);
    },
  });
  setMessagesRef.current = setMessages;
  const isBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const pendingText = pendingSendRef.current;
    if (!pendingText || !activeThread) return;
    pendingSendRef.current = null;
    void sendPreparedMessage(pendingText);
  }, [activeThread?.id]);

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
      const remainingThreads = (await loadChatThreads(props.profile.id)).filter((thread) => thread.id !== threadPendingRemoval.id);
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

  async function openEntryPanel(href: string | undefined) {
    if (!href?.startsWith("deana://entry/")) return;
    const entryId = decodeURIComponent(href.slice("deana://entry/".length));
    setPanel({ mode: "inspector", findingId: entryId, finding: null, isLoading: true, error: null });
    const finding = await loadReportEntry(props.profile.id, entryId);
    setPanel({
      mode: "inspector",
      findingId: entryId,
      finding,
      isLoading: false,
      error: finding ? null : "This finding is no longer available in the saved report.",
    });
  }

  function openFindingsPanel() {
    setPanel({ mode: "findings" });
  }

  const markdownComponents: Components = {
    a({ href, children }) {
      if (href?.startsWith("deana://entry/")) {
        return (
          <button className="dn-ai-entry-chip" type="button" onClick={() => void openEntryPanel(href)}>
            {children}
          </button>
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
          <button className="dn-ai-entry-chip" key={`${href}-${index}`} type="button" onClick={() => void openEntryPanel(href)}>
            Finding
          </button>,
        );
        lastIndex = index + href.length;
      }

      if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
      return nodes.length > 0 ? <>{nodes}</> : <>{children}</>;
    },
  };

  return (
    <section className={`dn-ai-screen ${isThreadPanelCollapsed ? "is-thread-collapsed" : ""}`} aria-labelledby="ai-chat-title">
      <h1 id="ai-chat-title" className="dn-screen-reader-text">AI chat</h1>
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
      <section className={`dn-ai-chat-pane ${isThreadListOpen ? "" : "is-open"}`}>
        <header className="dn-ai-panel__header">
          <button className="dn-button dn-button--secondary dn-ai-back" type="button" onClick={() => setIsThreadListOpen(true)}>
            <Icon name="chevronLeft" /> Threads
          </button>
        </header>

        {!hasConsented ? (
          <AiConsent onAccept={() => void acceptConsent()} />
        ) : (
          <>
            <div className="dn-ai-messages" aria-live="polite">
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
                  content={messageText(message)}
                  trace={traceByMessageRef.current[message.id]}
                  reasoningSummary={messageReasoning(message) ?? reasoningByMessageRef.current[message.id] ?? null}
                  components={markdownComponents}
                  onOpenEntry={(entryId) => void openEntryPanel(`deana://entry/${encodeURIComponent(entryId)}`)}
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
          onOpenEntry={(entryId) => void openEntryPanel(`deana://entry/${encodeURIComponent(entryId)}`)}
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

function AiSearchCard({ status }: { status: SearchStatus }) {
  if (status.status === "idle") return null;

  if (status.status === "checking") {
    return (
      <div className="dn-ai-search-card">
        <Icon name="search" />
        <span>Checking available context...</span>
      </div>
    );
  }

  if (status.status === "searching") {
    return (
      <div className="dn-ai-search-card">
        <Icon name="search" />
        <span>Searching saved report findings...</span>
      </div>
    );
  }

  if (status.status === "error") {
    return (
      <div className="dn-ai-search-card dn-ai-search-card--error">
        <Icon name="alert" />
        <span>{status.message}</span>
      </div>
    );
  }

  return (
    <div className="dn-ai-search-card">
      <Icon name="search" />
      <div>
        <strong>Searched {status.trace.scannedCategories.join(", ")}</strong>
        <span>{status.trace.resultCount} matching report findings sent for interpretation.</span>
        {status.trace.searchedTerms.length > 0 ? <small>{status.trace.searchedTerms.slice(0, 10).join(" · ")}</small> : null}
      </div>
    </div>
  );
}

function GeneratingStatus({ status }: { status: SearchStatus }) {
  const detail = status.status === "checking"
    ? "Checking available context..."
    : status.status === "searching"
      ? "Searching saved report findings..."
      : status.status === "ready"
        ? `Interpreting ${status.trace.resultCount} matched findings...`
        : status.status === "error"
          ? status.message
          : "Writing response...";

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
  return (
    <section className="dn-ai-consent">
      <Icon name="alert" />
      <h3>AI chat sends report context off this device</h3>
      <p>
        If you continue, Deana will send your chat text plus selected DNA markers, genotypes,
        matched findings, source names, and source links to Vercel AI Gateway and the routed model provider.
      </p>
      <p>
        Raw DNA files, full marker lists, profile names, and file names are not included. Consent and chat history are saved locally in this browser for this report.
      </p>
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
}: {
  panel: ChatPanel;
  traces: ChatRetrievalTrace[];
  searchStatus: SearchStatus;
  onClose: () => void;
  onBack: () => void;
  onOpenEntry: (entryId: string) => void;
}) {
  const effectiveTraces = searchStatus.status === "ready"
    ? [...traces.filter((trace) => trace.searchedAt !== searchStatus.trace.searchedAt), searchStatus.trace]
    : traces;
  const latestTrace = effectiveTraces[effectiveTraces.length - 1] ?? null;
  const findings = effectiveTraces.flatMap((trace) => trace.returnedFindings);
  const uniqueFindings = Array.from(new Map(findings.map((finding) => [finding.id, finding])).values());

  return (
    <aside className="dn-ai-side-panel" aria-label={panel.mode === "findings" ? "Chat findings" : "Chat inspector"}>
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
                  <div><dt>Matched</dt><dd>{latestTrace.resultCount.toLocaleString()} findings</dd></div>
                  <div><dt>Terms</dt><dd>{latestTrace.searchedTerms.length > 0 ? latestTrace.searchedTerms.slice(0, 16).join(", ") : "Prompt terms only"}</dd></div>
                  <div><dt>Related</dt><dd>{latestTrace.relatedTerms.length > 0 ? latestTrace.relatedTerms.slice(0, 12).join(", ") : "None returned"}</dd></div>
                </dl>
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
        <div className="dn-ai-inspector-panel">
          {panel.isLoading ? <p className="dn-ai-panel-empty">Loading finding...</p> : null}
          {panel.error ? <div className="dn-ai-error" role="alert"><Icon name="alert" /> {panel.error}</div> : null}
          {panel.finding ? <FindingDetailContent finding={panel.finding} titleLevel="h2" /> : null}
        </div>
      )}
    </aside>
  );
}

function ChatMessage({
  role,
  content,
  trace,
  reasoningSummary,
  components,
  onOpenEntry,
  onOpenFindings,
}: {
  role: UIMessage["role"];
  content: string;
  trace?: ChatRetrievalTrace;
  reasoningSummary: string | null;
  components: Components;
  onOpenEntry: (entryId: string) => void;
  onOpenFindings: () => void;
}) {
  const hasReasoning = Boolean(reasoningSummary?.trim());

  if (!content && !hasReasoning) return null;

  return (
    <article className={`dn-ai-message dn-ai-message--${role}`}>
      <span>{role === "user" ? "You" : "Deana AI"}</span>
      {hasReasoning && role === "assistant" ? <ModelReasoning reasoning={reasoningSummary ?? ""} /> : null}
      {content ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeSanitize, markdownSchema]]}
          components={components}
          urlTransform={(url) => url}
        >
          {content}
        </ReactMarkdown>
      ) : null}
      {role === "assistant" && trace ? (
        <TracePanel trace={trace} onOpenFindings={onOpenFindings} />
      ) : null}
    </article>
  );
}

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
  onOpenFindings,
}: {
  trace: ChatRetrievalTrace;
  onOpenFindings: () => void;
}) {
  return (
    <button className="dn-ai-findings-button" type="button" onClick={onOpenFindings}>
      <Icon name="search" />
      {trace.resultCount.toLocaleString()} matching findings sent
    </button>
  );
}
