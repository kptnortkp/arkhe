// Isomorphic: a short "<device> · <browser>" label from a User-Agent string.

function deviceOf(ua: string) {
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Linux/.test(ua)) return "Linux";
  return "Cihaz";
}

function browserOf(ua: string) {
  if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox|FxiOS/.test(ua)) return "Firefox";
  if (/Chrome|CriOS|Chromium/.test(ua)) return "Chrome";
  if (/Safari/.test(ua)) return "Safari";
  return "Tarayıcı";
}

export function deviceLabel(userAgent: string) {
  const ua = userAgent.slice(0, 512);
  return `${deviceOf(ua)} · ${browserOf(ua)}`;
}
