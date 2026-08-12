let _sdVoicesCache = null;

function _sdGetVoices() {
  try {
    if (typeof window === "undefined" || !window.speechSynthesis) return [];
    if (_sdVoicesCache && _sdVoicesCache.length) return _sdVoicesCache;
    _sdVoicesCache = window.speechSynthesis.getVoices() ?? [];
    if (!_sdVoicesCache.length) {
      try {
        window.speechSynthesis.onvoiceschanged = () => {
          _sdVoicesCache = window.speechSynthesis.getVoices() ?? [];
        };
      } catch {}
    }
    return _sdVoicesCache;
  } catch {
    return [];
  }
}


export function sdSpeakLocal({ text, voice = "", rate = 1, pitch = 1, volume = 1, lang = "" } = {}) {
  try {
    if (!text) return false;
    if (typeof window === "undefined" || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      console.warn("SD | TTS: Web Speech API not available in this browser.");
      return false;
    }
    const u = new SpeechSynthesisUtterance(String(text));
    const voices = _sdGetVoices();
    if (voice) {
      const v = voices.find(v => v.name === voice || v.voiceURI === voice);
      if (v) u.voice = v;
    }
    if (lang) u.lang = String(lang);
    u.rate   = Math.max(0.1, Math.min(10, Number(rate)   || 1));
    u.pitch  = Math.max(0,   Math.min(2,  Number(pitch)  || 1));
    u.volume = Math.max(0,   Math.min(1,  Number(volume) || 1));
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) {
    console.warn("SD | sdSpeakLocal error:", e);
    return false;
  }
}


export function sdSpeakBroadcast({ text, voice = "", rate = 1, pitch = 1, volume = 1, lang = "", target = "all" } = {}) {
  if (!text) return false;
  const payload = {
    type:    "tts",
    text:    String(text),
    voice:   String(voice ?? ""),
    rate:    Number(rate)   || 1,
    pitch:   Number(pitch)  || 1,
    volume:  Number(volume) || 1,
    lang:    String(lang  ?? ""),
    target:  String(target ?? "all"),
    fromUser: game?.user?.id ?? ""
  };
  try { game?.socket?.emit?.("system.sd", payload); }
  catch (e) { console.warn("SD | TTS broadcast emit failed:", e); }

  const t = String(target ?? "all");
  const isGM = !!game?.user?.isGM;
  const localShouldSpeak =
       t === "all"
    || t === "self"
    || (t === "gm"      && isGM)
    || (t === "players" && !isGM);
  if (localShouldSpeak) sdSpeakLocal({ text, voice, rate, pitch, volume, lang });
  return true;
}


export function sdHandleTTSSocket(data) {
  try {
    if (!data || data.type !== "tts") return;
    const me = game?.user?.id;
    if (data.fromUser && data.fromUser === me) return;

    const t = String(data.target ?? "all");
    if (t === "self")    return;
    if (t === "gm"      && !game?.user?.isGM) return;
    if (t === "players" &&  game?.user?.isGM) return;

    sdSpeakLocal({
      text:   data.text,
      voice:  data.voice,
      rate:   data.rate,
      pitch:  data.pitch,
      volume: data.volume,
      lang:   data.lang
    });
  } catch (e) {
    console.warn("SD | sdHandleTTSSocket error:", e);
  }
}


export function sdListTTSVoices() {
  return _sdGetVoices().map(v => ({ name: v.name, lang: v.lang, default: !!v.default }));
}
