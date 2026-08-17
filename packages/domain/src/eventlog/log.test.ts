import { describe, expect, it } from "vitest";
import { GraphError } from "../errors";
import { ev } from "../testing";
import { EventLog } from "./log";
import type { OrbitalEvent } from "./types";

const at = (n: number) => `2026-01-01T00:00:0${n}Z`;

const history: OrbitalEvent[] = [
  ev("NodeCreated", "a", { nodeKind: "source", intent: "the repo" }, { id: "e1", at: at(1) }),
  ev("NodeCreated", "b", { nodeKind: "derivation", intent: "write it up" }, { id: "e2", at: at(2) }),
  ev(
    "EdgeAdded",
    "b",
    { edgeId: "x1", from: "a", to: "b", aperture: "artifact" },
    { id: "e3", at: at(3) },
  ),
  ev("IntentChanged", "b", { intent: "write it up, briefly" }, { id: "e4", at: at(4) }),
];

const log = () => EventLog.from("g", history);

describe("the log is append-only and immutable", () => {
  it("leaves the earlier log untouched when appended to", () => {
    const before = EventLog.from("g", history.slice(0, 2));
    const after = before.append(history[2]!);
    expect(before.state.edges.size).toBe(0);
    expect(after.state.edges.size).toBe(1);
    expect(before.events).toHaveLength(2);
  });

  it("rejects an event id it already holds", () => {
    try {
      log().append(history[0]!);
      throw new Error("expected a GraphError");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphError);
      expect((error as GraphError).code).toBe("duplicate-event");
    }
  });
});

describe("time is a shorter prefix", () => {
  it("gives the graph as it stood at a moment", () => {
    expect(log().stateAt(at(1)).nodes.size).toBe(1);
    expect(log().stateAt(at(2)).nodes.size).toBe(2);
    expect(log().stateAt(at(2)).edges.size).toBe(0);
    expect(log().stateAt(at(3)).edges.size).toBe(1);
  });

  it("is inclusive of the moment itself", () => {
    expect(log().stateAt(at(4)).nodes.get("b")?.intent).toBe("write it up, briefly");
    expect(log().stateAt(at(3)).nodes.get("b")?.intent).toBe("write it up");
  });
});

describe("a fork is a new log from a prefix", () => {
  it("cuts at an event", () => {
    const forked = log().fork({ eventId: "e3" });
    expect(forked.events.map((event) => event.id)).toEqual(["e1", "e2", "e3"]);
    expect(forked.state.nodes.get("b")?.intent).toBe("write it up");
  });

  it("cuts at a moment", () => {
    expect(log().fork({ at: at(2) }).events).toHaveLength(2);
  });

  it("rebrands the events onto the new graph, keeping their ids", () => {
    const forked = log().fork({ eventId: "e2" }, "h");
    expect(forked.graphId).toBe("h");
    expect(forked.state.graphId).toBe("h");
    expect(forked.events.map((event) => event.graphId)).toEqual(["h", "h"]);
    expect(forked.events.map((event) => event.id)).toEqual(["e1", "e2"]);
  });

  it("leaves the original alone", () => {
    const original = log();
    original.fork({ eventId: "e1" }, "h");
    expect(original.events).toHaveLength(4);
    expect(original.state.graphId).toBe("g");
  });

  it("rejects a cut at an event it does not hold", () => {
    try {
      log().fork({ eventId: "nope" });
      throw new Error("expected a GraphError");
    } catch (error) {
      expect((error as GraphError).code).toBe("unknown-fork-point");
    }
  });
});
