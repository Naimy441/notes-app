"use client";

/**
 * Voice dictation with the device's own speech recognition (Web Speech API).
 * On an iPhone that is Apple's built-in dictation; on a Mac in Chrome or Safari
 * it is the browser's recognizer. No audio is sent to this app's server.
 *
 * Where the recognizer isn't available or refuses to run (some iOS home-screen
 * apps, Firefox), the caller falls back to the keyboard: the iPhone keyboard's
 * own mic button is the same built-in dictation.
 */

export type DictationLang = "auto" | "en" | "ar";
export type DictationPhase = "starting" | "listening";

export interface DictationHandlers {
  /** Words still being recognized. Empty string clears. */
  interim(text: string): void;
  /** A finished phrase to insert. */
  final(text: string): void;
  phase(phase: DictationPhase): void;
  /**
   * The session ended. `error` explains a failure; `useKeyboard` means the
   * recognizer can't run here, so offer the keyboard's mic instead.
   */
  ended(result?: { error: string; useKeyboard: boolean }): void;
}

type SpeechResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type RecognizerCtor = new () => Recognizer;

function recognizerCtor(): RecognizerCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether built-in speech recognition exists in this browser at all. */
export const canDictate = () => !!recognizerCtor();

const KEYBOARD_HINT = "Use the mic on your keyboard to dictate.";

function speechLang(lang: DictationLang) {
  if (lang === "ar") return "ar-SA";
  if (lang === "en") return navigator.language?.startsWith("en") ? navigator.language : "en-US";
  return navigator.language || "en-US";
}

export class Dictation {
  private want = false;
  private rec: Recognizer | null = null;
  private heard = false;

  constructor(
    private readonly h: DictationHandlers,
    private lang: DictationLang,
  ) {}

  get active() {
    return this.want;
  }

  /** Call from a tap: iOS only starts the recognizer inside a user gesture. */
  start() {
    if (this.want) return;
    this.want = true;
    if (!recognizerCtor()) return this.finish({ error: `Dictation isn't available here. ${KEYBOARD_HINT}`, useKeyboard: true });
    this.listen();
  }

  /** Stop listening; a phrase already being recognized is still delivered. */
  stop() {
    if (!this.want) return;
    this.want = false;
    if (!this.rec) return this.finish();
    try {
      this.rec.stop();
    } catch {
      this.finish();
    }
  }

  /** Switch language mid-session by restarting the recognizer. */
  setLang(lang: DictationLang) {
    if (lang === this.lang) return;
    this.lang = lang;
    if (!this.want || !this.rec) return;
    const rec = this.rec;
    this.rec = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {}
    this.h.interim("");
    this.listen();
  }

  private finish(result?: { error: string; useKeyboard: boolean }) {
    this.want = false;
    this.rec = null;
    this.h.interim("");
    this.h.ended(result);
  }

  private listen() {
    let rec: Recognizer;
    try {
      rec = new (recognizerCtor()!)();
    } catch {
      return this.finish({ error: `Couldn't start dictation. ${KEYBOARD_HINT}`, useKeyboard: true });
    }
    this.rec = rec;
    rec.lang = speechLang(this.lang);
    rec.continuous = true;
    rec.interimResults = true;
    this.h.phase("starting");
    rec.onstart = () => {
      if (this.rec === rec) this.h.phase("listening");
    };
    rec.onresult = (event) => {
      if (this.rec !== rec) return;
      let partial = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          this.heard = true;
          if (text.trim()) this.h.final(text);
        } else partial += text;
      }
      this.h.interim(partial);
    };
    rec.onerror = (event) => {
      if (this.rec !== rec) return;
      const err = event.error;
      if (err === "no-speech" || err === "aborted") return; // onend restarts or finishes
      this.rec = null;
      rec.onend = null;
      if (err === "not-allowed" || err === "service-not-allowed") {
        // Blocked permissions, or Apple/Google speech isn't offered here (common in home-screen apps).
        this.finish({
          error: this.heard ? "Dictation stopped: speech recognition was turned off." : `Speech recognition isn't allowed here. ${KEYBOARD_HINT}`,
          useKeyboard: !this.heard,
        });
      } else if (err === "network") {
        this.finish({ error: `Dictation needs a connection here. ${KEYBOARD_HINT}`, useKeyboard: true });
      } else if (err === "audio-capture") {
        this.finish({ error: "No microphone was found.", useKeyboard: false });
      } else if (err === "language-not-supported") {
        this.finish({ error: "That dictation language isn't supported on this device.", useKeyboard: false });
      } else {
        this.finish({ error: "Dictation stopped unexpectedly.", useKeyboard: false });
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.h.interim("");
      // Safari and Chrome end a session after a pause; keep listening until stopped.
      if (!this.want) return this.finish();
      window.setTimeout(() => {
        if (!this.want || this.rec !== rec) return;
        try {
          rec.start();
        } catch {
          this.finish();
        }
      }, 150);
    };
    try {
      rec.start();
    } catch {
      this.rec = null;
      this.finish({ error: `Couldn't start dictation. ${KEYBOARD_HINT}`, useKeyboard: true });
    }
  }
}
