import assert from "node:assert/strict";

class Collection extends Map { [Symbol.iterator]() { return this.values(); } }
const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) { const list = hooks.get(name) ?? []; list.push(fn); hooks.set(name, list); return fn; },
  once() {}, off(name, fn) { hooks.set(name, (hooks.get(name) ?? []).filter(f => f !== fn)); }, callAll() {}
};
async function fire(name, ...args) { for (const fn of [...(hooks.get(name) ?? [])]) await fn(...args); }
globalThis.document = { getElementById: () => ({}), createElement: () => ({ textContent: "", appendChild() {} }), head: { appendChild() {} } };
globalThis.window = { addEventListener() {} };
globalThis.Actor = class {};
globalThis.Item = class {};
class Sheet { constructor(document) { this.document = document; } }
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DocumentSheetV2: Sheet } }, data: { fields: {} },
  utils: { getProperty: (o, p) => String(p).split(".").reduce((v, k) => v?.[k], o), deepClone: structuredClone } };
const gm = { id: "gm", active: true, isGM: true }, player = { id: "player", active: true, isGM: false };
globalThis.game = { user: player, users: new Collection([[gm.id, gm], [player.id, player]]), actors: new Collection(), items: new Collection(), playlists: new Collection(), scenes: new Collection(), settings: { get() {} }, i18n: { lang: "en" } };
const documents = new Map();
globalThis.fromUuid = async uuid => documents.get(uuid);
const { NODE_DEFS, SD_NODE_REGISTRY, FormulaGraph } = await import("../module/builder/formula-graph.mjs");
const { registerLifecycleNodes } = await import("../module/builder/lifecycle-nodes.mjs");
const { installLifecycleEvents } = await import("../module/helpers/lifecycle-events.mjs");
const { EVENT_BUS } = await import("../module/helpers/event-bus.mjs");
const { registerNodeActionHandler } = await import("../module/helpers/node-runtime-api.mjs");
const { ButtonExecutor } = await import("../module/helpers/button-executor.mjs");
const { registerMusicNodes, installMusicActions } = await import("../module/builder/music-nodes.mjs");
const { LocalMusic, LOCAL_MUSIC, controlPlaylist } = await import("../module/helpers/music-runtime.mjs");
registerLifecycleNodes(SD_NODE_REGISTRY);
registerMusicNodes(SD_NODE_REGISTRY);
installMusicActions();
const captures = [];
SD_NODE_REGISTRY.registerNode("test_capture", { cat: "Events", title: "Capture", isAction: true,
  inputs: [{ id: "exec", type: "exec" }, { id: "value", type: "value.string" }], outputs: [],
  toAction: (n, i) => ({ type: "test_capture", value: i.value, label: n.data.label }) });
registerNodeActionHandler("test_capture", async ctx => captures.push([ctx.action.label, await ctx.resolveValue(ctx.action.value)]));

function graphPayload(type, data, output, label) {
  const graph = Object.create(FormulaGraph.prototype);
  graph.nodes = [{ id: "event", type, data }, { id: "action", type: "test_capture", data: { label } }];
  graph.edges = [{ fromNode: "event", fromPin: "exec", toNode: "action", toPin: "exec" }, { fromNode: "event", fromPin: output, toNode: "action", toPin: "value" }];
  const payload = JSON.parse(graph.compile());
  assert.equal(payload._trigger, "multi");
  assert.equal(Object.values(payload._events)[0].hook, type === "on_sheet_open" ? "sdSheetOpen" : "sdMapLoaded");
  return payload;
}
const actor = { documentName: "Actor", id: "a", uuid: "Actor.a", name: "Actor A", items: [], system: { sdTriggerGraph: graphPayload("on_sheet_open", { documentUuid: "self" }, "documentUuid", "self") } };
const item = { documentName: "Item", id: "i", uuid: "Item.i", name: "World Item", system: { sdTriggerGraph: graphPayload("on_sheet_open", { documentUuid: "Actor.a" }, "userId", "specific") } };
game.actors.set(actor.id, actor); game.items.set(item.id, item);
documents.set(actor.uuid, actor); documents.set(item.uuid, item);
EVENT_BUS._registerActor(actor); EVENT_BUS._registerWorldItem(item);
installLifecycleEvents(EVENT_BUS); installLifecycleEvents(EVENT_BUS);
assert.equal(hooks.get("renderApplicationV2").length, 1, "Bridge initialization must be idempotent");
const sheet = new Sheet(actor);
await fire("renderApplicationV2", sheet);
assert.deepEqual(captures, [["self", "Actor.a"], ["specific", "player"]]);
await fire("renderApplicationV2", sheet);
assert.equal(captures.length, 2, "Re-render retriggered Sheet Open");
await fire("closeApplicationV2", sheet);
await fire("renderApplicationV2", sheet);
assert.equal(captures.length, 4, "Reopening must trigger again");
await fire("renderApplicationV2", new Sheet({ uuid: "Actor.other", documentName: "Actor" }));
await fire("renderApplicationV2", { document: actor });
assert.equal(captures.length, 4, "Unrelated sheet or configuration app triggered event");
const tokenActor = { ...actor, isToken: true, uuid: "Scene.map.Token.t.Actor.a" };
await fire("renderApplicationV2", new Sheet(tokenActor));
assert.deepEqual(captures.at(-1), ["self", tokenActor.uuid]);
assert.equal(EVENT_BUS._resolveEventActor({ actorId: "a" }, [{ document: tokenActor }], "sdSheetOpen"), tokenActor);

item.system.sdTriggerGraph = graphPayload("on_map_loaded", { sceneUuid: "Scene.map" }, "sceneUuid", "map");
EVENT_BUS._registerWorldItem(item);
const map = { scene: { uuid: "Scene.map", id: "map", name: "Map" } };
await fire("canvasReady", map);
assert.deepEqual(captures.at(-1), ["map", "Scene.map"]);
const count = captures.length;
await fire("canvasReady", map);
assert.equal(captures.length, count, "Duplicate canvasReady must not duplicate event");
await fire("canvasTearDown", map); await fire("canvasReady", map);
assert.equal(captures.length, count + 1, "Reloading the map should trigger again");
await fire("canvasTearDown", map); await fire("canvasReady", { scene: { uuid: "Scene.other", id: "other" } });
assert.equal(captures.length, count + 1);
const mapEntry = { actorId: null, docUuid: item.uuid, data: { sceneFilter: "map", runFor: "gm" } };
assert.equal(EVENT_BUS._matches("sdMapLoaded", [{ sceneUuid: "Scene.map", sceneId: "map" }], mapEntry), false);
game.user = gm;
assert.equal(EVENT_BUS._matches("sdMapLoaded", [{ sceneUuid: "Scene.map", sceneId: "map" }], mapEntry), true);
const initial = [];
globalThis.canvas = { ...map, ready: true };
installLifecycleEvents({ _dispatch: async (hook, args) => initial.push([hook, args[0].sceneUuid]) });
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(initial, [["sdMapLoaded", "Scene.map"]]);

class FakeSound {
  constructor(src) { this.src = src; this.calls = []; this.currentTime = 12; this.playing = false; }
  async load() { if (this.src === "missing.ogg") throw new Error("Audio 404"); }
  async play(options) { this.playing = true; this.calls.push(["play", options]); }
  pause() { this.playing = false; this.pausedTime = this.currentTime; this.calls.push(["pause"]); }
  async stop(options) { this.playing = false; this.calls.push(["stop", options]); }
  async fade(volume, options) { this.calls.push(["fade", volume, options]); }
}
const local = new LocalMusic(src => new FakeSound(src));
await local.play({ src: "worlds/world/song.ogg", channel: "a", volume: 0.4, loop: "yes" });
const first = local.channels.get("a").sound;
assert.equal(first.calls[0][1].loop, true);
await local.control("pause", { channel: "a" });
assert.equal(first.pausedTime, 12);
await local.control("resume", { channel: "a" });
assert.equal(first.calls.at(-1)[1].offset, undefined, "Resume must preserve Sound.pausedTime");
await local.control("volume", { channel: "a", volume: 2, fade: 500 });
assert.deepEqual(first.calls.at(-1), ["fade", 1, { duration: 500 }]);
await local.play({ src: "next.ogg", channel: "a" });
assert.equal(first.playing, false, "Replacing a channel should stop its previous track");
await local.control("stop", { channel: "a" });
await local.control("stop", { channel: "a" });
assert.equal(local.channels.size, 0);
await assert.rejects(local.play({ src: "missing.ogg" }), /404/);
await assert.rejects(local.control("resume", {}), /not playing/);
await assert.rejects(local.play({ src: "javascript:alert(1)" }), /HTTP/);
let release;
const slow = new LocalMusic(src => Object.assign(new FakeSound(src), { load: () => new Promise(resolve => { release = resolve; }) }));
const pending = slow.play({ src: "slow.ogg" });
const lateSound = slow.channels.get("music").sound;
await slow.control("stop");
await assert.rejects(pending, /cancelled/);
release(); await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(lateSound.calls.filter(c => c[0] === "play").length, 0, "Late audio download restarted stopped music");

const track = { id: "s", uuid: "Playlist.p.PlaylistSound.s", playing: true, pausedTime: null, sound: { currentTime: 0 } };
const other = { id: "s2", uuid: "Playlist.p.PlaylistSound.s2", playing: false, pausedTime: null };
const operations = [];
const playlist = { id: "p", uuid: "Playlist.p", name: "Music", mode: 1, sounds: [track, other], canUserModify: user => user.isGM,
  async playAll() { operations.push(["all"]); }, async playSound(sound) { operations.push(["play", sound.id]); },
  async stopAll() { operations.push(["stopAll"]); }, async stopSound(sound) { operations.push(["stop", sound.id]); },
  async playNext(id, options) { operations.push(["next", id, options]); },
  async update(data) { operations.push(["update", data]); for (const change of data.sounds) Object.assign(this.sounds.find(s => s.id === change._id), change); },
  async updateEmbeddedDocuments(type, data) { operations.push([type, data]); }
};
game.playlists.set(playlist.id, playlist);
await controlPlaylist("play", { playlistUuid: "Playlist.p" });
await controlPlaylist("play", { playlistUuid: "p", soundUuid: track.uuid });
assert.deepEqual(operations.slice(0, 2), [["all"], ["play", "s"]]);
await controlPlaylist("pause", { playlistUuid: "p" });
assert.equal(track.pausedTime, 0, "Pause at zero must remain resumable");
await controlPlaylist("resume", { playlistUuid: "p" });
assert.equal(track.playing, true); assert.equal(other.playing, false, "Resume must not start unpaused tracks");
await controlPlaylist("previous", { playlistUuid: "p", soundUuid: "s" });
assert.deepEqual(operations.at(-1), ["next", "s", { direction: -1 }]);
await controlPlaylist("volume", { playlistUuid: "p", volume: 0 });
assert.deepEqual(operations.at(-1)[1], [{ _id: "s", volume: 0 }, { _id: "s2", volume: 0 }]);
await assert.rejects(controlPlaylist("play", { playlistUuid: "p", soundUuid: "wrong" }), /Track not found/);
game.user = player;
const beforePermission = operations.length;
await assert.rejects(controlPlaylist("stop", { playlistUuid: "p" }), /permission/);
assert.equal(operations.length, beforePermission);

// Exercise compiled action fields through the production executor and typed outputs.
LOCAL_MUSIC.createSound = src => new FakeSound(src);
const runtime = {};
const start = NODE_DEFS.music_play.toAction({ id: "start", data: { src: "song.ogg", channel: "Канал" } });
assert.equal((await ButtonExecutor._runAction(start, null, {}, {}, runtime)).success, true);
const stop = NODE_DEFS.music_stop.toAction({ id: "stop", data: {} }, { channel: "{__nodeResult:start|channel}" });
assert.equal((await ButtonExecutor._runAction(stop, null, {}, {}, runtime)).channel, "Канал");
const denied = NODE_DEFS.music_playlist_play.toAction({ id: "denied", data: { playlistUuid: "p" } });
assert.equal((await ButtonExecutor._runAction(denied, null, {}, {}, runtime)).success, false);
assert.match(runtime.__nodeResults.denied.error, /permission/);
assert.equal(Object.keys(NODE_DEFS).filter(k => k.startsWith("music_")).length, 8);
console.log("PASS: lifecycle compilation/dispatch, sheet self/UUID/reopen, map filtering/initial load/GM, local music lifecycle/cancellation, shared playlists/permissions and executor outputs");
