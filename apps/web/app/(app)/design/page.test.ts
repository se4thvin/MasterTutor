import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/design/design-system-view.tsx", () => ({ DesignSystemView: () => null }));

const { default: DesignPage } = await import("./page.tsx");

describe("/design (D48)", () => {
  it("answers 404 in a production build", () => {
    // vitest.config.ts defines __FIXTURE_BUILD__ as false, like `next build` without WEB_FIXTURE_API.
    let thrown: unknown;
    try {
      DesignPage();
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { digest?: string } | undefined)?.digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });
});
