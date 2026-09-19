import { describe, expect, it } from "vitest";
import { RESPONSE_LOG_BUFFERS } from "./session.ts";

describe("response log buffers (Task 0 review M8)", () => {
  it("bounds what Chromium keeps for later body reads", () => {
    expect(RESPONSE_LOG_BUFFERS.maxResourceBufferSize).toBeGreaterThanOrEqual(1024 * 1024);
    expect(RESPONSE_LOG_BUFFERS.maxResourceBufferSize).toBeLessThanOrEqual(
      RESPONSE_LOG_BUFFERS.maxTotalBufferSize,
    );
    expect(RESPONSE_LOG_BUFFERS.maxTotalBufferSize).toBeLessThanOrEqual(32 * 1024 * 1024);
  });
});
