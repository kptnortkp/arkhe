import { Fragment } from "react";

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
// Punctuation that usually ends the sentence, not the link.
const TRAILING = /[.,;:!?)\]}»”’]+$/;

function safeHref(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Plain text with its line breaks (the parent sets white-space); only http(s) URLs become links. */
export function LinkifiedText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index;
    const raw = match[0].replace(TRAILING, "");
    const href = safeHref(raw);
    if (!href) continue;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a
        key={start}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline underline-offset-2 [overflow-wrap:anywhere]"
      >
        {raw}
      </a>,
    );
    last = start + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}
