import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRecord } from "../src/types/job";

vi.mock("../src/services/browser/session", () => ({
  closeBrowserSession: vi.fn(async () => undefined),
  createBrowserSession: vi.fn(),
}));

vi.mock("../src/services/fallback/oxylabsFallback", () => ({
  runOxylabsFallback: vi.fn(async () => []),
}));

vi.mock("../src/services/browser/otterFlow", () => ({
  performOtterLoginFlow: vi.fn(async () => undefined),
  gotoToleratingOtterNavigation: vi.fn(async () => undefined),
}));

vi.mock("../src/services/extraction/extract", () => ({
  extractResult: vi.fn(async () => ({
    finalUrl: "https://otter.ai/u/mock-id",
    sourceUrl: "https://otter.ai/u/mock-id",
    pageTitle: "Otter",
    summary: "summary",
    transcript: "transcript",
    goalAssessment: {
      meetsGoal: true,
      confidence: "high",
      reason: "Extracted summary or transcript from Otter page.",
      missingRequirements: [],
    },
    trace: [],
  })),
}));

import { createBrowserSession } from "../src/services/browser/session";
import { performOtterLoginFlow } from "../src/services/browser/otterFlow";
import { extractResult } from "../src/services/extraction/extract";
import { runOxylabsFallback } from "../src/services/fallback/oxylabsFallback";
import { JobStore } from "../src/services/jobStore";
import { createScrapeWorker } from "../src/workers/scrapeWorker";

describe("scrapeWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails Otter jobs directly instead of invoking Oxylabs fallback", async () => {
    const jobStore = new JobStore();
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: "otter-job",
      status: "queued",
      request: {
        url: "https://otter.ai/u/mock-id",
        goal: "Extract transcript and summary from the Otter transcript page.",
        sourceType: "otter",
        loginFields: [
          { name: "email", value: "user@example.com", secret: true },
          { name: "password", value: "password123", secret: true },
        ],
      },
      createdAt: now,
      updatedAt: now,
      progress: {
        step: 0,
        maxSteps: 8,
        message: "Queued",
      },
      cancelRequested: false,
    };

    jobStore.create(job);
    vi.mocked(createBrowserSession).mockRejectedValue(new Error("browser unavailable"));

    await createScrapeWorker(jobStore)("otter-job");

    const updatedJob = jobStore.get("otter-job");
    expect(runOxylabsFallback).not.toHaveBeenCalled();
    expect(updatedJob?.status).toBe("failed");
    expect(updatedJob?.progress.message).toBe("Otter extraction failed");
    expect(updatedJob?.error).toContain("browser unavailable");
    expect(updatedJob?.result).toBeUndefined();
  });

  it("fails Loom jobs directly instead of invoking Oxylabs fallback", async () => {
    const jobStore = new JobStore();
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: "loom-job",
      status: "queued",
      request: {
        url: "https://www.loom.com/share/0123456789abcdef0123456789abcdef",
        goal: "Extract transcript and summary from the Loom video page.",
        sourceType: "loom",
        loginFields: [
          { name: "email", value: "user@example.com", secret: true },
          { name: "password", value: "password123", secret: true },
        ],
      },
      createdAt: now,
      updatedAt: now,
      progress: {
        step: 0,
        maxSteps: 8,
        message: "Queued",
      },
      cancelRequested: false,
    };

    jobStore.create(job);
    vi.mocked(createBrowserSession).mockRejectedValue(new Error("browser unavailable"));

    await createScrapeWorker(jobStore)("loom-job");

    const updatedJob = jobStore.get("loom-job");
    expect(runOxylabsFallback).not.toHaveBeenCalled();
    expect(updatedJob?.status).toBe("failed");
    expect(updatedJob?.progress.message).toBe("Loom extraction failed");
    expect(updatedJob?.error).toContain("browser unavailable");
    expect(updatedJob?.result).toBeUndefined();
  });

  it("does not open the Otter conversation URL before login", async () => {
    const jobStore = new JobStore();
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: "otter-skip-initial-goto",
      status: "queued",
      request: {
        url: "https://otter.ai/u/mock-id",
        goal: "Extract transcript and summary from the Otter transcript page.",
        sourceType: "otter",
        loginFields: [
          { name: "email", value: "user@example.com", secret: true },
          { name: "password", value: "password123", secret: true },
        ],
      },
      createdAt: now,
      updatedAt: now,
      progress: {
        step: 0,
        maxSteps: 8,
        message: "Queued",
      },
      cancelRequested: false,
    };

    const page = {
      goto: vi.fn(async () => undefined),
      url: vi.fn(() => "about:blank"),
      title: vi.fn(async () => ""),
    };
    jobStore.create(job);
    vi.mocked(createBrowserSession).mockResolvedValue({
      browser: {},
      context: {},
      page,
    } as never);

    await createScrapeWorker(jobStore)("otter-skip-initial-goto");

    expect(page.goto).not.toHaveBeenCalled();
    expect(performOtterLoginFlow).toHaveBeenCalledWith(
      page,
      "https://otter.ai/u/mock-id",
      expect.arrayContaining([
        expect.objectContaining({ name: "email" }),
        expect.objectContaining({ name: "password" }),
      ]),
    );
    expect(extractResult).toHaveBeenCalled();
    expect(jobStore.get("otter-skip-initial-goto")?.status).toBe("succeeded");
  });
});
