// @vitest-environment happy-dom
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import { liveTween, previewWith, tween } from "../../hooks/gsapParsedTween.test-helpers";
import { usePlayerStore } from "../../player/store/playerStore";
import { GsapEditBlockedError } from "../../hooks/gsapEditOutcome";
import { commitNodeDrop, nodeDropLabel } from "./motionPathCommit";

it("names a node drop for its undo entry by what it moved", () => {
  const { autoKeyframeEnabled } = usePlayerStore.getState();
  onTestFinished(() => usePlayerStore.setState({ autoKeyframeEnabled }));
  usePlayerStore.setState({ autoKeyframeEnabled: true });
  expect(nodeDropLabel({ type: "keyframe", pct: 50 })).toBe("Move keyframe");
  usePlayerStore.setState({ autoKeyframeEnabled: false });
  expect(nodeDropLabel({ type: "keyframe", pct: 50 })).toBe("Move animation path");
  expect(nodeDropLabel({ type: "waypoint", index: 0 })).toBe("Move waypoint");
});

afterEach(() => {
  usePlayerStore.setState({ currentTime: 0, activeKeyframePct: null, requestedSeekTime: null });
  document.body.innerHTML = "";
});

it("a keyframe node's drop changes that keyframe and keeps a newly animated channel on the others", async () => {
  const el = document.createElement("div");
  el.id = "box";
  document.body.append(el);
  const selection = { id: "box", selector: "#box", element: el } as DomEditSelection;
  // keyframes: [{ x: 60, duration: 2 }, { x: 120, duration: 1 }], over a CSS translate GSAP read as y 30.
  const keys = tween({
    id: "#box-to-0-position",
    method: "to",
    properties: {},
    resolvedStart: 0,
    duration: 3,
    keyframes: {
      format: "object-array",
      keyframes: [
        { percentage: 66.7, properties: { x: 60 } },
        { percentage: 100, properties: { x: 120 } },
      ],
    },
  });
  const steps = [
    { startTime: () => 0, duration: () => 2 },
    { startTime: () => 2, duration: () => 1 },
  ];
  const live = liveTween(el, { start: 0, duration: 3, vars: { keyframes: [] } }, { parts: steps });
  const iframe = previewWith(el, [live], { x: 60, y: 30 });
  usePlayerStore.setState({ currentTime: 2, autoKeyframeEnabled: true });
  const commitMutation = vi.fn(async () => {});

  await commitNodeDrop({
    ref: { type: "keyframe", pct: 100 },
    at: { x: 150, y: 90 },
    animId: keys.id,
    anim: keys,
    selection,
    iframe,
    commitMutation,
  });

  const [mutation] = commitMutation.mock.calls.map((call) => call[0] as Record<string, never>);
  expect(mutation!.type).toBe("replace-with-keyframes");
  expect((mutation!.keyframes as { properties: object }[]).map((kf) => kf.properties)).toEqual([
    { x: 60, y: 30 },
    { x: 150, y: 90 },
  ]);
});

it("a drop on an array step's node edits that step, though the path spaces nodes evenly", async () => {
  const el = document.body.appendChild(document.createElement("div"));
  el.id = "box";
  const selection = { id: "box", selector: "#box", element: el } as DomEditSelection;
  // Step ends at 2 s and 3 s; the path draws the first node at 0%, the parser and lane at 66.7%.
  const keys = tween({
    id: "#box-to-0-position",
    method: "to",
    properties: {},
    resolvedStart: 0,
    duration: 3,
    keyframes: {
      format: "object-array",
      keyframes: [
        { percentage: 66.7, properties: { x: 60, y: 30 } },
        { percentage: 100, properties: { x: 120, y: 30 } },
      ],
    },
  });
  const steps = [
    { startTime: () => 0, duration: () => 2 },
    { startTime: () => 2, duration: () => 1 },
  ];
  const live = liveTween(el, { start: 0, duration: 3, vars: { keyframes: [] } }, { parts: steps });
  usePlayerStore.setState({ currentTime: 1, autoKeyframeEnabled: true, activeKeyframePct: null });
  const commitMutation = vi.fn(async () => {});

  await commitNodeDrop({
    ref: { type: "keyframe", pct: 0, step: 0 },
    at: { x: 40, y: 90 },
    animId: keys.id,
    anim: keys,
    selection,
    iframe: previewWith(el, [live], { x: 60, y: 30 }),
    commitMutation,
  });

  const [mutation] = commitMutation.mock.calls.map((call) => call[0] as Record<string, never>);
  expect((mutation!.keyframes as { properties: object }[]).map((kf) => kf.properties)).toEqual([
    { x: 40, y: 90 },
    { x: 120, y: 30 },
  ]);
  expect(usePlayerStore.getState().requestedSeekTime).toBe(2);
});

it("a drop the writer refuses rejects with the reason, writes nothing and selects nothing", async () => {
  const [a, b] = ["a", "b"].map((id) => {
    const el = document.body.appendChild(document.createElement("div"));
    el.id = id;
    el.className = "card";
    return el;
  });
  const shared = tween({
    targetSelector: ".card",
    method: "to",
    properties: {},
    resolvedStart: 0,
    duration: 1,
    keyframes: { format: "percentage", keyframes: [{ percentage: 100, properties: { x: 20 } }] },
  });
  usePlayerStore.setState({ autoKeyframeEnabled: true, activeKeyframePct: null });
  const commitMutation = vi.fn(async () => {});
  const drop = commitNodeDrop({
    ref: { type: "keyframe", pct: 100 },
    at: { x: 5, y: 0 },
    animId: shared.id,
    anim: shared,
    selection: { id: "a", selector: "#a", element: a! } as DomEditSelection,
    iframe: previewWith(b!, [], { x: 0, y: 0 }),
    commitMutation,
  });
  await expect(drop).rejects.toBeInstanceOf(GsapEditBlockedError);
  expect(commitMutation).not.toHaveBeenCalled();
  expect(usePlayerStore.getState().activeKeyframePct).toBeNull();
});

it("with auto-keyframe off, a step's node shifts the path by its own keyframe's move", async () => {
  const el = document.body.appendChild(document.createElement("div"));
  el.id = "box";
  const selection = { id: "box", selector: "#box", element: el } as DomEditSelection;
  // Steps of 4 s, 1 s and 1 s: drawn at 0/50/100%, parsed at their step ends.
  const keys = tween({
    id: "#box-to-0-position",
    method: "to",
    properties: {},
    resolvedStart: 0,
    duration: 6,
    keyframes: {
      format: "object-array",
      keyframes: [66.7, 83.3, 100].map((percentage, i) => ({
        percentage,
        properties: { x: 60 * (i + 1), y: 0 },
      })),
    },
  });
  usePlayerStore.setState({ autoKeyframeEnabled: false, activeKeyframePct: null });
  const commitMutation = vi.fn(async () => {});

  await commitNodeDrop({
    ref: { type: "keyframe", pct: 50, step: 1 },
    at: { x: 157, y: 0 },
    animId: keys.id,
    anim: keys,
    selection,
    iframe: null,
    commitMutation,
  });

  const [mutation] = commitMutation.mock.calls.map((call) => call[0] as Record<string, never>);
  const xs = (mutation!.keyframes as { properties: { x: number } }[]).map((kf) => kf.properties.x);
  expect(xs).toEqual([97, 157, 217]);
});
