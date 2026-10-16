import { describe, expect, it, vi } from "vitest";
import {
  gotoToleratingOtterNavigation,
  isInterruptedNavigationError,
} from "../src/services/browser/otterFlow";

const CONVERSATION_URL = "https://otter.ai/u/mockId?tab=chat&view=transcript";
const HOME_URL = "https://otter.ai/home";
const INTERRUPT_ERROR = new Error(
  `page.goto: Navigation to "${CONVERSATION_URL}" is interrupted by another navigation to "${HOME_URL}"`,
);

function createPage(initialUrl = "about:blank") {
  let currentUrl = initialUrl;
  return {
    url: () => currentUrl,
    setUrl(nextUrl: string) {
      currentUrl = nextUrl;
    },
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
    }),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
  };
}

describe("gotoToleratingOtterNavigation", () => {
  it("detects Playwright interrupted-navigation errors", () => {
    expect(isInterruptedNavigationError(INTERRUPT_ERROR)).toBe(true);
    expect(isInterruptedNavigationError(new Error("Timeout 30000ms exceeded"))).toBe(false);
  });

  it("returns after a successful conversation navigation", async () => {
    const page = createPage();
    await gotoToleratingOtterNavigation(page as never, CONVERSATION_URL);
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith(CONVERSATION_URL, { waitUntil: "domcontentloaded" });
    expect(page.url()).toBe(CONVERSATION_URL);
  });

  it("treats an interrupted goto as success when the conversation URL already landed", async () => {
    const page = createPage();
    page.goto.mockImplementation(async () => {
      page.setUrl(CONVERSATION_URL);
      throw INTERRUPT_ERROR;
    });

    await gotoToleratingOtterNavigation(page as never, CONVERSATION_URL);
    expect(page.goto).toHaveBeenCalledTimes(1);
  });

  it("retries when Otter interrupts /u navigation with /home", async () => {
    const page = createPage();
    page.goto
      .mockImplementationOnce(async () => {
        page.setUrl(HOME_URL);
        throw INTERRUPT_ERROR;
      })
      .mockImplementationOnce(async (url: string) => {
        page.setUrl(url);
      });

    await gotoToleratingOtterNavigation(page as never, CONVERSATION_URL);
    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(page.url()).toContain("/u/mockId");
  });

  it("retries when goto resolves but the SPA has already bounced to /home", async () => {
    const page = createPage();
    page.goto
      .mockImplementationOnce(async () => {
        page.setUrl(HOME_URL);
      })
      .mockImplementationOnce(async (url: string) => {
        page.setUrl(url);
      });

    await gotoToleratingOtterNavigation(page as never, CONVERSATION_URL);
    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(page.url()).toContain("/u/mockId");
  });

  it("rethrows non-interrupt navigation errors immediately", async () => {
    const page = createPage();
    page.goto.mockRejectedValue(new Error("net::ERR_CONNECTION_RESET"));

    await expect(gotoToleratingOtterNavigation(page as never, CONVERSATION_URL)).rejects.toThrow(
      "net::ERR_CONNECTION_RESET",
    );
    expect(page.goto).toHaveBeenCalledTimes(1);
  });

  it("throws the interrupt error after retries still land on /home", async () => {
    const page = createPage();
    page.goto.mockImplementation(async () => {
      page.setUrl(HOME_URL);
      throw INTERRUPT_ERROR;
    });

    await expect(gotoToleratingOtterNavigation(page as never, CONVERSATION_URL)).rejects.toThrow(
      /interrupted by another navigation/,
    );
    expect(page.goto).toHaveBeenCalledTimes(3);
  });
});
