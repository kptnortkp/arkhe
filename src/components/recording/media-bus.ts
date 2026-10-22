// One thing plays at a time: recordings and MIDI players claim the bus before they start.
type Playable = { pause: () => void };

let current: Playable | null = null;

export function claimPlayback(p: Playable) {
  if (current && current !== p) current.pause();
  current = p;
}

export function releasePlayback(p: Playable) {
  if (current === p) current = null;
}
