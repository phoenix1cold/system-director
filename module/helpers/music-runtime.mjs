export function musicNumber(value, fallback, min, max) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) throw new Error("Music parameter must be a finite number");
  return Math.max(min, Math.min(max, n));
}

export function audioPath(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Specify an audio file path");
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) throw new Error("Use a Foundry file path or HTTP(S) audio URL");
  return /^(?:https?:|\/)/i.test(raw) ? raw : (globalThis.foundry?.utils?.getRoute?.(raw) ?? raw);
}

export class LocalMusic {
  constructor(createSound = src => new foundry.audio.Sound(src, { context: game.audio.music })) {
    this.createSound = createSound;
    this.channels = new Map();
  }

  async play(args = {}) {
    const id = String(args.channel || "music");
    const src = audioPath(args.src);
    const volume = musicNumber(args.volume, 0.5, 0, 1), fade = musicNumber(args.fade, 0, 0, 60000);
    const loop = [true, "true", "yes", 1, "1"].includes(args.loop);
    const previous = this.channels.get(id);
    const record = { sound: this.createSound(src), ready: false, volume, loop };
    this.channels.set(id, record);
    let timer;
    const cancelled = new Promise((_, reject) => {
      record.cancel = () => reject(new Error("Music playback cancelled"));
      timer = setTimeout(() => reject(new Error("Music loading timed out (60 seconds)")), 60000);
    });
    const current = () => this.channels.get(id) === record;
    record.onended = () => { if (current()) this.channels.delete(id); };
    // Attach the cancellation handler before any asynchronous work begins.
    const loading = (async () => {
      if (previous) { previous.cancel?.(); if (previous.ready) await previous.sound.stop(); }
      if (!current()) throw new Error("Music playback replaced");
      await record.sound.load();
      if (!current()) throw new Error("Music playback cancelled");
      if (record.sound.failed) throw new Error("Audio file failed to load");
      record.ready = true;
      await record.sound.play({ volume, loop, fade, onended: record.onended });
      if (!current()) { await record.sound.stop(); throw new Error("Music playback cancelled"); }
    })();
    try { await Promise.race([loading, cancelled]); }
    catch (error) {
      if (current()) this.channels.delete(id);
      if (record.ready) await record.sound.stop();
      throw error;
    } finally { clearTimeout(timer); record.cancel = null; }
    return { channel: id };
  }

  async control(operation, args = {}) {
    const id = String(args.channel || "music"), record = this.channels.get(id);
    if (operation === "stop") {
      const fade = musicNumber(args.fade, 0, 0, 60000);
      if (record) {
        this.channels.delete(id);
        record.cancel?.();
        if (record.ready) await record.sound.stop({ fade });
      }
      return { channel: id };
    }
    if (!record?.ready) throw new Error("Music channel is not playing or still loading");
    if (operation === "pause") record.sound.pause();
    else if (operation === "resume") {
      if (!record.sound.playing) await record.sound.play({ volume: record.volume, loop: record.loop, onended: record.onended });
    }
    else if (operation === "volume") {
      record.volume = musicNumber(args.volume, 0.5, 0, 1);
      await record.sound.fade(record.volume, { duration: musicNumber(args.fade, 0, 0, 60000) });
    } else throw new Error("Unknown local music operation");
    return { channel: id };
  }
}

export const LOCAL_MUSIC = new LocalMusic();

export function findMusicPlaylist(ref) {
  const id = String(ref ?? "").trim();
  return id ? [...(globalThis.game?.playlists ?? [])].find(playlist => playlist.uuid === id || playlist.id === id) : undefined;
}

export async function controlPlaylist(operation, args = {}) {
  const playlist = findMusicPlaylist(args.playlistUuid);
  if (!playlist) throw new Error("Select an existing Foundry playlist (UUID or ID)");
  if (!playlist.canUserModify(game.user, "update")) throw new Error("You do not have permission to control this playlist");
  const ref = String(args.soundUuid ?? "").trim();
  const sounds = [...playlist.sounds];
  const sound = ref ? sounds.find(sound => sound.uuid === ref || sound.id === ref) : null;
  if (ref && !sound) throw new Error("Track not found in the selected playlist");
  const selected = sound ? [sound] : sounds;
  if (operation === "play") {
    if (!selected.length) throw new Error("The playlist has no tracks");
    if (sound) await playlist.playSound(sound);
    else await playlist.playAll();
  } else if (operation === "stop") {
    if (sound) await playlist.stopSound(sound);
    else await playlist.stopAll();
  } else if (operation === "next" || operation === "previous") {
    if (![0, 1].includes(playlist.mode)) throw new Error("Next/previous requires a sequential or shuffled playlist");
    await playlist.playNext(sound?.id, { direction: operation === "next" ? 1 : -1 });
  } else if (operation === "pause") {
    const updates = selected.filter(sound => sound.playing).map(sound => {
      const time = sound.sound?.currentTime;
      if (!Number.isFinite(time)) throw new Error("The track is not loaded on this client yet");
      return { _id: sound.id, playing: false, pausedTime: time };
    });
    const paused = new Set(updates.map(update => update._id));
    if (updates.length) await playlist.update({ playing: sounds.some(s => s.playing && !paused.has(s.id)), sounds: updates });
  } else if (operation === "resume") {
    const updates = selected.filter(sound => !sound.playing && sound.pausedTime != null)
      .map(sound => ({ _id: sound.id, playing: true }));
    if (!updates.length) throw new Error("No paused tracks to resume");
    await playlist.update({ playing: true, sounds: updates });
  } else if (operation === "volume") {
    const volume = musicNumber(args.volume, 0.5, 0, 1);
    await playlist.updateEmbeddedDocuments("PlaylistSound", selected.map(sound => ({ _id: sound.id, volume })));
  } else throw new Error("Unknown playlist operation");
  return { playlistUuid: playlist.uuid, soundUuid: sound?.uuid ?? "" };
}
