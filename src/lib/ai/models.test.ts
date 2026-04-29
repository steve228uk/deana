import { describe, expect, it } from "vitest";
import { DEANA_MODELS, selectChatModels } from "./models";

describe("selectChatModels", () => {
  it("prefers Gemma for simple greetings", () => {
    expect(selectChatModels([{ category: "medical", evidenceTier: "high" }], "hello")).toEqual([
      DEANA_MODELS.cheap,
      DEANA_MODELS.default,
    ]);
  });

  it("keeps stronger routing for advisory medical prompts", () => {
    expect(selectChatModels([{ category: "medical", evidenceTier: "high" }], "Should I take medication?")).toEqual([
      DEANA_MODELS.default,
      DEANA_MODELS.strongFallback,
    ]);
  });
});
