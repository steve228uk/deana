import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerRequest, WorkerResponse } from "./searchIndexCore";

const coreMocks = vi.hoisted(() => ({
  clearSearchIndex: vi.fn(),
  prewarmSearchIndex: vi.fn(async () => undefined),
  queryCandidateIds: vi.fn(async () => [] as string[]),
  searchExplorerEntryIds: vi.fn(async () => ({ ids: [], count: 0 })),
  searchWithFields: vi.fn(async () => []),
  waitForIndex: vi.fn(async () => undefined),
}));

vi.mock("./searchIndexCore", async (importOriginal) => ({
  ...await importOriginal<typeof import("./searchIndexCore")>(),
  clearSearchIndex: coreMocks.clearSearchIndex,
  prewarmSearchIndex: coreMocks.prewarmSearchIndex,
  queryCandidateIds: coreMocks.queryCandidateIds,
  searchExplorerEntryIds: coreMocks.searchExplorerEntryIds,
  searchWithFields: coreMocks.searchWithFields,
  waitForIndex: coreMocks.waitForIndex,
}));

class MockSearchWorker {
  static instances: MockSearchWorker[] = [];

  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly terminate = vi.fn();
  readonly postMessage = vi.fn((message: WorkerRequest) => {
    if (!this.autoRespond) return;
    this.respond({ type: message.type, requestId: message.requestId } as WorkerResponse);
  });

  constructor(private readonly autoRespond = true) {
    MockSearchWorker.instances.push(this);
  }

  respond(response: WorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const originalWorker = globalThis.Worker;
const profileId = "profile-1";

function setGlobalWorker(value: unknown): void {
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value,
  });
}

function installWorker(factory: () => MockSearchWorker) {
  const WorkerConstructor = vi.fn(function WorkerConstructor() {
    return factory();
  });
  setGlobalWorker(WorkerConstructor);
  return WorkerConstructor;
}

function expectPrewarmPosted(worker: MockSearchWorker): void {
  expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: "prewarm",
    profileId,
  }));
}

describe("search index worker client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    MockSearchWorker.instances = [];
  });

  afterEach(() => {
    setGlobalWorker(originalWorker);
  });

  it("retries worker creation after a constructor failure", async () => {
    let shouldThrow = true;
    const WorkerConstructor = installWorker(() => {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error("worker startup failed");
      }
      return new MockSearchWorker();
    });
    const { prewarmSearchIndex } = await import("./searchIndex");

    await prewarmSearchIndex(profileId);
    await prewarmSearchIndex(profileId);

    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(coreMocks.prewarmSearchIndex).toHaveBeenCalledTimes(1);
    expect(MockSearchWorker.instances).toHaveLength(1);
    expectPrewarmPosted(MockSearchWorker.instances[0]);
  });

  it("retries worker creation after a runtime worker error", async () => {
    let shouldAutoRespond = false;
    const WorkerConstructor = installWorker(() => {
      const worker = new MockSearchWorker(shouldAutoRespond);
      shouldAutoRespond = true;
      return worker;
    });
    const { prewarmSearchIndex } = await import("./searchIndex");

    const firstPrewarm = prewarmSearchIndex(profileId);
    MockSearchWorker.instances[0].fail("transient worker error");
    await expect(firstPrewarm).rejects.toThrow("transient worker error");

    await prewarmSearchIndex(profileId);

    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(coreMocks.prewarmSearchIndex).not.toHaveBeenCalled();
    expect(MockSearchWorker.instances).toHaveLength(2);
    expect(MockSearchWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    expectPrewarmPosted(MockSearchWorker.instances[1]);
  });
});
