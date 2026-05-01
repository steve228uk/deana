import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExplorerShell } from "./explorer";
import {
  DEANA_SUPPORT_URL,
  MarketingFirstVisit,
  SupportDeanaModal,
  UploadReportModal,
} from "./marketing";

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

describe("SupportDeanaModal", () => {
  it("shows support copy and links to Buy Me a Coffee", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<SupportDeanaModal onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "Support Deana" })).toBeInTheDocument();
    expect(screen.getByText(/Deana is a small project I build and run myself/i)).toBeInTheDocument();
    expect(screen.getByText(/owning their own data, keeping private things private/i)).toBeInTheDocument();
    expect(screen.getByText(/helps pay for the less glamorous bits/i)).toBeInTheDocument();
    expect(screen.queryByText("Stephen Radford")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Buy Me a Coffee/i })).toHaveAttribute(
      "href",
      DEANA_SUPPORT_URL,
    );

    await user.click(within(screen.getByRole("dialog", { name: "Support Deana" })).getByText("Close"));

    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("support triggers", () => {
  it("opens the support modal from the marketing header", async () => {
    const user = userEvent.setup();

    function SupportMarketingHarness() {
      const [isSupportOpen, setIsSupportOpen] = useState(false);

      return (
        <>
          <MarketingFirstVisit onSupport={() => setIsSupportOpen(true)} />
          {isSupportOpen ? <SupportDeanaModal onClose={() => setIsSupportOpen(false)} /> : null}
        </>
      );
    }

    render(<SupportMarketingHarness />);

    await user.click(screen.getByRole("button", { name: /Support Deana/i }));

    expect(screen.getByRole("dialog", { name: "Support Deana" })).toBeInTheDocument();
  });

  it("opens the support modal from Explorer", async () => {
    const user = userEvent.setup();

    render(
      <ExplorerShell
        report={{
          id: "profile-1",
          name: "Example",
          provider: "23andMe",
          build: "GRCh37",
          markerCount: 1234,
          evidencePackVersion: "2026-05-core",
        }}
        activeTab="overview"
      >
        <p>Explorer content</p>
      </ExplorerShell>,
    );

    await user.click(screen.getAllByRole("button", { name: /Support Deana/i })[0]);

    expect(screen.getByRole("dialog", { name: "Support Deana" })).toBeInTheDocument();
  });
});
