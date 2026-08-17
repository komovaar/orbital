import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "./index";

describe("the server can see the domain", () => {
  it("folds an empty log", () => {
    const log = emptyWorkspace("g");
    expect(log.state.graphId).toBe("g");
    expect(log.state.nodes.size).toBe(0);
  });
});
