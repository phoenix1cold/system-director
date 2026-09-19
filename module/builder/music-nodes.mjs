import { registerNodeActionHandler } from "../helpers/node-runtime-api.mjs";
import { LOCAL_MUSIC, controlPlaylist, findMusicPlaylist } from "../helpers/music-runtime.mjs";

const OWNER = "sd:music";
const field = (key, label, value = "", type = "text", options) => ({ key, label, default: value, type, ...(options ? { options } : {}) });
const pin = (id, label, type = "string") => ({ id, label, type: `value.${type}` });
const channel = () => field("channel", "Channel ID", "music");
const volume = () => field("volume", "Volume (0–1)", 0.5, "number");
const fade = () => field("fade", "Fade (ms)", 0, "number");
const resultToken = (node, output) => `{__nodeResult:${node.id}|${output}}`;
const playlistFields = () => [
  field("playlistUuid", "Playlist", "", "select", () => [{ value: "", label: "Select playlist…" }, ...[...(globalThis.game?.playlists ?? [])].map(p => ({ value: p.uuid, label: p.name }))]),
  field("soundUuid", "Track (empty = playlist)", "", "select", node => [{ value: "", label: "Whole playlist" }, ...[...(findMusicPlaylist(node.data?.playlistUuid)?.sounds ?? [])].map(s => ({ value: s.uuid, label: s.name }))])
];

export function registerMusicNodes(registry = globalThis.SD?.nodeRegistry ?? globalThis.CONFIG?.SD?.nodeRegistry) {
  if (!registry?.registerNode) return;
  registry.registerCategory({ id: "Music", label: "Music", labels: { en: "Music", ru: "Музыка" }, color: "#9270c9" }, { owner: OWNER });
  function add(type, title, desc, fields, resultPins, operation) {
    registry.registerNode(type, {
      title, desc, cat: "Music", color: "#9270c9", wideNode: true, isAction: true,
      inputs: [{ id: "exec", label: "", type: "exec" }, ...fields.map(f => pin(f.key, f.label, f.type === "number" ? "number" : "string"))],
      outputs: [{ id: "exec", label: "Then", type: "exec" }, ...resultPins, pin("success", "Success", "bool"), pin("error", "Error")],
      fields, dynamicBranchToken: resultToken, compilePin: (n, _i, p) => resultToken(n, p),
      toAction: (node, connected = {}) => ({ type, __resultNodeId: node.id, operation,
        args: Object.fromEntries(fields.map(f => [f.key, connected[f.key] ??
          (f.type === "number" ? (node.data?.[f.key] ?? f.default) : JSON.stringify(node.data?.[f.key] ?? f.default))])) })
    }, { owner: OWNER });
  }
  const localOutput = [pin("channel", "Channel ID")];
  add("music_play", "Play Music", "Play an audio file locally on the current client. Same Channel ID replaces its previous track. Does not broadcast to other users.",
    [channel(), field("src", "Audio file path"), volume(), fade(), field("loop", "Loop", "yes", "select", ["yes", "no"])], localOutput, "play");
  add("music_pause", "Pause Music", "Pause a local music channel and remember its position.", [channel()], localOutput, "pause");
  add("music_resume", "Resume Music", "Resume a local music channel from its paused position.", [channel()], localOutput, "resume");
  add("music_stop", "Stop Music", "Stop and release a local music channel. Optional fade-out in milliseconds.", [channel(), fade()], localOutput, "stop");
  add("music_volume", "Music Volume", "Set the local channel volume from 0 to 1, optionally with a fade.", [channel(), volume(), fade()], localOutput, "volume");
  const playlistOutput = [pin("playlistUuid", "Playlist UUID"), pin("soundUuid", "Track UUID")];
  add("music_playlist_play", "Play Playlist", "Start a shared Foundry playlist or a selected track for all clients. Requires playlist update permission.", playlistFields(), playlistOutput, "play");
  add("music_playlist_control", "Control Playlist", "Pause, resume, stop, or switch tracks in a shared playlist. Next/previous require sequential or shuffled mode. Requires playlist update permission.",
    [...playlistFields(), field("operation", "Operation", "stop", "select", ["pause", "resume", "stop", "next", "previous"])], playlistOutput, "control");
  add("music_playlist_volume", "Playlist Volume", "Set persistent volume (0–1) on one track or every track in the selected shared playlist. Requires playlist update permission.",
    [...playlistFields(), volume()], playlistOutput, "volume");
}

export function installMusicActions() {
  for (const type of ["music_play", "music_pause", "music_resume", "music_stop", "music_volume", "music_playlist_play", "music_playlist_control", "music_playlist_volume"]) {
    registerNodeActionHandler(type, async ctx => {
      const args = {};
      try {
        for (const [key, value] of Object.entries(ctx.action?.args ?? {})) args[key] = ctx.resolveValue ? await ctx.resolveValue(value) : value;
        let value;
        if (type.startsWith("music_playlist_")) value = await controlPlaylist(type === "music_playlist_control" ? args.operation : ctx.action.operation, args);
        else value = type === "music_play" ? await LOCAL_MUSIC.play(args) : await LOCAL_MUSIC.control(ctx.action.operation, args);
        return { ...value, success: true, error: "" };
      } catch (error) {
        const message = String(error?.message ?? error);
        globalThis.ui?.notifications?.warn?.(`Music: ${message}`);
        return { channel: String(args.channel ?? ""), playlistUuid: String(args.playlistUuid ?? ""), soundUuid: String(args.soundUuid ?? ""), success: false, error: message };
      }
    }, { owner: OWNER });
  }
}

globalThis.Hooks?.once?.("ready", () => { registerMusicNodes(); installMusicActions(); });
