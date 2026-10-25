"""The 20-page limit (D101), in its own step without the secret: pypdf parses the untrusted PDF.

Usage: pages.py INPUT.pdf FAILURE.json. Exit 0 when 1-20 pages; else FAILURE.json gets
pdf_unreadable or too_many_pages and the exit code is 1.
"""

import json
import sys

from pypdf import PdfReader

MAX_PAGES = 20


def main(pdf, failure):
    try:
        reader = PdfReader(pdf)
        if reader.is_encrypted:
            reader.decrypt("")
        pages = len(reader.pages)
    except Exception:
        pages = 0
    print(f"pages: {pages}")
    kind = "pdf_unreadable" if pages < 1 else "too_many_pages" if pages > MAX_PAGES else None
    if kind:
        with open(failure, "w", encoding="utf-8") as f:
            json.dump({"kind": kind}, f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
