// The no-JS check-in reports its error as a fixed key in the URL, so no text can be injected.
const CHECK_IN_ERRORS = {
  kod: "Kod hatalı ya da yenilendi. Ekrandaki yeni kodu gir.",
  limit: "Çok fazla hatalı deneme. Birkaç dakika bekle ya da yoklamayı alan kişiye söyle.",
  bicim: "Kod 4 haneli olmalı.",
  isaretli: "Yoklamayı alan kişi seni zaten işaretledi.",
} as const;

type CheckInErrorKey = keyof typeof CHECK_IN_ERRORS;

export function checkInErrorKey(message: string) {
  const keys = Object.keys(CHECK_IN_ERRORS) as CheckInErrorKey[];
  return keys.find((k) => CHECK_IN_ERRORS[k] === message) ?? null;
}

export function checkInErrorMessage(key: unknown) {
  return typeof key === "string" && Object.hasOwn(CHECK_IN_ERRORS, key)
    ? CHECK_IN_ERRORS[key as CheckInErrorKey]
    : undefined;
}
