import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UploadReportModal } from "./marketing";

describe("UploadReportModal", () => {
  it("replaces the uploader with locked local parsing progress", () => {
    const onFileChange = vi.fn();

    render(
      <UploadReportModal
        step="choose-file"
        isParsing
        parseProgress={{
          phase: "parsing",
          percent: 42,
          message: "Parsing markers locally...",
        }}
        onFileChange={onFileChange}
      />,
    );

    expect(screen.queryByText(/Drag and drop your file here/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(screen.getByText("Parsing markers locally...")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "42% parsed" })).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByRole("button", { name: /Close/i })).toBeDisabled();
  });
});
