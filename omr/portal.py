"""The workflow's side of the portal contract (D98). Standard library only: the workflow runs it
with the system interpreter in isolated mode (`/usr/bin/python3 -I -S`), so no installed package
ever runs next to the secret.

Every request carries X-Arkhe-Timestamp and X-Arkhe-Signature =
hex(HMAC-SHA256(secret, "<timestamp>.<METHOD>.<path>.<sha256(body)>")). The portal URL comes from
the repo variable PORTAL_URL, never from a workflow input. Nothing here prints the secret, the
signature or file bytes.

  portal.py running                 report `running` with GITHUB_RUN_ID
  portal.py fetch OUT.pdf           fetch the score; checks type and size (pages: omr/pages.py)
  portal.py result OUT.mid SUMMARY  post the MIDI and the summary
  portal.py fail [FAILURE.json]     post the kind in FAILURE.json, else output_invalid
"""

import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request

MAX_PDF = 4 * 1024 * 1024
RETRY = {500, 502, 503, 504}
KINDS = {"pdf_unreadable", "too_many_pages", "no_music", "layout_mismatch", "output_invalid"}


def env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(f"{name} is not set")
    return value


def base_url():
    url = env("PORTAL_URL").rstrip("/")
    local = url.startswith("http://127.0.0.1") or url.startswith("http://localhost")
    if not (url.startswith("https://") or local):
        sys.exit("PORTAL_URL must be https")
    return url


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect would carry the signature headers to another host: fail instead."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def request(method, kind, body=b"", attempts=3):
    job = env("JOB_ID")
    path = f"/api/omr/{job}/{kind}"
    secret = env("OMR_CALLBACK_SECRET").encode()
    for attempt in range(attempts):
        ts = str(int(time.time()))
        digest = hashlib.sha256(body).hexdigest()
        sig = hmac.new(secret, f"{ts}.{method}.{path}.{digest}".encode(), hashlib.sha256).hexdigest()
        req = urllib.request.Request(
            base_url() + path,
            data=body if method == "POST" else None,
            method=method,
            headers={
                "X-Arkhe-Timestamp": ts,
                "X-Arkhe-Signature": sig,
                "Content-Type": "application/json",
                "User-Agent": "arkhe-omr-workflow",
            },
        )
        try:
            with OPENER.open(req, timeout=60) as res:
                return res.status, res.read()
        except urllib.error.HTTPError as e:
            if e.code not in RETRY or attempt == attempts - 1:
                return e.code, b""
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts - 1:
                return 0, b""
        time.sleep(5 * (attempt + 1))
    return 0, b""


def write_failure(path, kind, **extra):
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"kind": kind, **extra}, f)
    print(f"failure: {kind}")
    sys.exit(3)


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "running":
        run_id = os.environ.get("GITHUB_RUN_ID", "")
        body = json.dumps({"state": "running", "runId": run_id if run_id.isdigit() else None}).encode()
        status, _ = request("POST", "durum", body)
        print(f"running: {status}")
        if status != 200:
            sys.exit(1)
    elif cmd == "fetch":
        out, failure = argv[2], "failure.json"
        status, data = request("GET", "nota")
        print(f"fetch: {status}")
        if status != 200:
            sys.exit(1)
        if len(data) > MAX_PDF or not data[:1024].count(b"%PDF-") or b"%%EOF" not in data[-1024:]:
            write_failure(failure, "pdf_unreadable")
        with open(out, "wb") as f:
            f.write(data)
    elif cmd == "result":
        with open(argv[2], "rb") as f:
            midi = f.read()
        with open(argv[3], encoding="utf-8") as f:
            summary = json.load(f)
        body = json.dumps({"midi": base64.b64encode(midi).decode(), "summary": summary}).encode()
        status, _ = request("POST", "sonuc", body)
        print(f"result: {status}")
        if status != 201:
            sys.exit(1)
    elif cmd == "fail":
        payload = {"state": "failed", "kind": "output_invalid"}
        path = argv[2] if len(argv) > 2 else "failure.json"
        # Written by steps that ran untrusted code: read as plain data, never trusted to be well-formed.
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = None
        if isinstance(data, dict) and data.get("kind") in KINDS:
            payload["kind"] = data["kind"]
            exp, found = data.get("expected"), data.get("found")
            ok = all(type(v) is int and 0 <= v <= 40 for v in (exp, found))
            if data["kind"] == "layout_mismatch" and ok:
                payload["expected"], payload["found"] = exp, found
        status, _ = request("POST", "durum", json.dumps(payload).encode())
        print(f"fail {payload['kind']}: {status}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
