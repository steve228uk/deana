import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// The evidence build can populate autoDefinitions.ts with tens of thousands
// of object literals. V8 OOMs trying to parse it at test startup. Tests only
// exercise the 12 hand-crafted definitions so an empty array is correct here.
vi.mock("../lib/autoDefinitions", () => ({ AUTO_DEFINITION_PARAMS: [] }));

afterEach(() => {
  cleanup();
});
