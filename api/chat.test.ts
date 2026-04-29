import { describe, expect, it } from "vitest";
import { trimMessagesToRecentWindow } from "./chat.js";

function buildMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text: `message-${index}` }],
  }));
}

describe("trimMessagesToRecentWindow", () => {
  it("keeps payload unchanged when messages are at or under max", () => {
    const payload = {
      consent: { accepted: true, version: "v1" },
      context: { contextVersion: "v1" },
      messages: buildMessages(12),
    };

    expect(trimMessagesToRecentWindow(payload)).toEqual(payload);
  });

  it("trims to the most recent message window", () => {
    const payload = {
      consent: { accepted: true, version: "v1" },
      context: { contextVersion: "v1" },
      messages: buildMessages(16),
    };

    expect(trimMessagesToRecentWindow(payload)).toEqual({
      ...payload,
      messages: payload.messages.slice(-12),
    });
  });

  it("ignores non-object payloads", () => {
    expect(trimMessagesToRecentWindow(null)).toBeNull();
    expect(trimMessagesToRecentWindow("not-an-object")).toBe("not-an-object");
  });
});
