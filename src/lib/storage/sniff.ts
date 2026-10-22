// Pure: decides the stored type from the bytes alone. The browser's Content-Type and file name are
// never trusted (D6). Raw MPEG and ADTS need a second frame, WebM its DocType, Ogg an audio codec
// header, MIDI a full chunk walk, so random binary or text almost never passes.
import type { RecordingType } from "./limits";

const ascii = (b: Uint8Array, at: number, text: string) => {
  if (at + text.length > b.length) return false;
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
};
const u32 = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];

function isoBmff(b: Uint8Array) {
  if (b.length < 12 || !ascii(b, 4, "ftyp")) return false;
  const size = u32(b, 0);
  return size >= 8 && size <= 1024 && size <= b.length;
}

const MP3_BITRATES = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Length of an MPEG Layer III frame starting at `at`, or 0 when it isn't one. */
function mp3Frame(b: Uint8Array, at: number) {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return 0;
  const version = (b[at + 1] >> 3) & 3;
  const layer = (b[at + 1] >> 1) & 3;
  const bitrateIndex = b[at + 2] >> 4;
  const rateIndex = (b[at + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3)
    return 0;
  const v1 = version === 3;
  const bitrate = (v1 ? MP3_BITRATES.v1 : MP3_BITRATES.v2)[bitrateIndex] * 1000;
  const rate = MP3_RATES[version as 0 | 2 | 3][rateIndex];
  const padding = (b[at + 2] >> 1) & 1;
  return Math.floor(((v1 ? 144 : 72) * bitrate) / rate) + padding;
}

/** Length of an ADTS frame starting at `at`, or 0. */
function adtsFrame(b: Uint8Array, at: number) {
  if (at + 7 > b.length || b[at] !== 0xff || (b[at + 1] & 0xf6) !== 0xf0) return 0;
  if (((b[at + 2] >> 2) & 0xf) >= 13) return 0;
  const length = ((b[at + 3] & 3) << 11) | (b[at + 4] << 3) | (b[at + 5] >> 5);
  return length >= 7 ? length : 0;
}

/** A frame at `at` followed by a second one (or by the exact end of the file). */
function twoFrames(b: Uint8Array, at: number, frame: (b: Uint8Array, at: number) => number) {
  const first = frame(b, at);
  if (!first) return false;
  const next = at + first;
  return next === b.length || frame(b, next) > 0;
}

/** Offset after an ID3v2 tag, 0 when there is none, -1 when the tag is malformed. */
function afterId3(b: Uint8Array) {
  if (!ascii(b, 0, "ID3")) return 0;
  if (b.length < 10 || b[3] === 0xff || b[4] === 0xff) return -1;
  for (let i = 6; i < 10; i++) if (b[i] >= 0x80) return -1;
  const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

function mpegOrAdts(b: Uint8Array): RecordingType | null {
  const start = afterId3(b);
  if (start < 0 || start >= b.length) return null;
  // After a tag, encoders may pad before the first frame.
  const end = start === 0 ? 1 : Math.min(b.length, start + 4096);
  for (let at = start; at < end; at++) {
    if (b[at] !== 0xff) continue;
    if (twoFrames(b, at, mp3Frame)) return "audio/mpeg";
    if (twoFrames(b, at, adtsFrame)) return "audio/aac";
  }
  return null;
}

function webm(b: Uint8Array) {
  if (b.length < 8 || u32(b, 0) !== 0x1a45dfa3) return false;
  for (let at = 4; at < Math.min(b.length - 3, 64); at++) {
    if (b[at] !== 0x42 || b[at + 1] !== 0x82) continue;
    const sizeByte = b[at + 2];
    if (!(sizeByte & 0x80)) continue;
    const length = sizeByte & 0x7f;
    return length === 4 && ascii(b, at + 3, "webm");
  }
  return false;
}

function ogg(b: Uint8Array) {
  if (b.length < 28 || !ascii(b, 0, "OggS") || b[4] !== 0 || !(b[5] & 0x02)) return false;
  const packet = 27 + b[26];
  return ascii(b, packet, "OpusHead") || (b[packet] === 0x01 && ascii(b, packet + 1, "vorbis"));
}

function wav(b: Uint8Array) {
  if (!ascii(b, 0, "RIFF") || !ascii(b, 8, "WAVE")) return false;
  for (let at = 12; at + 8 <= Math.min(b.length, 128);) {
    if (ascii(b, at, "fmt ")) return true;
    const size = (b[at + 4] | (b[at + 5] << 8) | (b[at + 6] << 16) | (b[at + 7] << 24)) >>> 0;
    at += 8 + size + (size & 1);
  }
  return false;
}

export function sniffAudio(b: Uint8Array): RecordingType | null {
  if (isoBmff(b)) return "audio/mp4";
  if (webm(b)) return "audio/webm";
  if (ogg(b)) return "audio/ogg";
  if (wav(b)) return "audio/wav";
  return mpegOrAdts(b);
}

/** A Standard MIDI File with PPQ timing that our player can time; every chunk inside the file. */
export function checkMidi(b: Uint8Array) {
  if (b.length < 22 || !ascii(b, 0, "MThd") || u32(b, 4) !== 6) return false;
  const format = u16(b, 8);
  const tracks = u16(b, 10);
  const division = u16(b, 12);
  if (format > 2 || tracks < 1 || tracks > 128 || division === 0 || division & 0x8000) return false;
  let at = 14;
  let mtrk = 0;
  while (at + 8 <= b.length) {
    const length = u32(b, at + 4);
    if (at + 8 + length > b.length) return false;
    if (ascii(b, at, "MTrk")) mtrk++;
    at += 8 + length;
  }
  return mtrk > 0 && b.length - at < 8;
}
