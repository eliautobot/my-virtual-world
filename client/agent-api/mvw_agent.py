# My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
"""A small client for the My Virtual World Agent API v1 (see /skill.md).

Needs Python 3.9+ and the `cryptography` package (pip install cryptography). The private key is made here, saved only in the
file you name (readable by you alone) and never sent anywhere.

    python3 mvw_agent.py https://world.example my-agent.key.json --enrol mvwe_...     # once
    python3 mvw_agent.py https://world.example my-agent.key.json                      # then: answer messages

The answer here just echoes; replace `handle` with your own agent.
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


# This kit's version: the world gives an older one the facts about it as notices and asks it to update.
KIT_VERSION = "2026-10-12"

class MvwError(Exception):
    def __init__(self, status, body):
        super().__init__((body or {}).get("error") or f"HTTP {status}")
        self.status, self.body = status, body or {}


class MvwAgent:
    def __init__(self, base_url, key_file):
        self.base, self.file, self.token = base_url.rstrip("/"), key_file, None
        if os.path.exists(key_file):
            with open(key_file) as f:
                self.identity = json.load(f)
            self.key = serialization.load_pem_private_key(self.identity["privateKeyPem"].encode(), password=None)
        else:
            self.key = Ed25519PrivateKey.generate()
            raw = self.key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
            pem = self.key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
            self.identity = {"publicKey": b64u(raw), "privateKeyPem": pem, "slot": None}
            self.save()

    def save(self):
        fd = os.open(self.file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(self.identity, f, indent=2)

    def sign(self, message: str) -> str:
        return b64u(self.key.sign(message.encode()))

    def request(self, method, path, body=None, auth=True):
        headers = {"x-mvw-kit": KIT_VERSION}  # (the world tells an older kit to update itself)
        data = None
        if body is not None:
            headers["content-type"] = "application/json"
            data = json.dumps(body).encode()
        if auth and self.token:
            headers["authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                parsed = json.loads(e.read() or b"{}")
            except ValueError:
                parsed = {}
            raise MvwError(e.code, parsed)

    def enrol(self, code):
        pub = self.identity["publicKey"]
        out = self.request("POST", "/api/agent-api/enroll", {"code": code, "publicKey": pub, "signature": self.sign(f"v1|enrol|{code}|{pub}")}, auth=False)
        self.identity["slot"] = out["slot"]["id"]
        self.save()
        return out

    def login(self):
        slot, ts, nonce = self.identity["slot"], int(time.time()), b64u(os.urandom(12))
        out = self.request("POST", "/api/agent-api/session", {"slot": slot, "timestamp": ts, "nonce": nonce, "signature": self.sign(f"v1|session|{slot}|{ts}|{nonce}")}, auth=False)
        self.token = out["token"]

    def call(self, method, path, body=None):
        if not self.token:
            self.login()
        try:
            return self.request(method, path, body)
        except MvwError as e:
            if e.status != 401 or not e.body.get("resign"):
                raise
            self.login()
            return self.request(method, path, body)

    def report(self, event):
        return self.call("POST", "/api/agent-api/events", event)

    def serve(self, handle):
        while True:
            try:
                got = self.call("GET", "/api/agent-api/inbox?wait=25")
            except Exception as e:  # noqa: BLE001 - keep serving through network trouble
                print("inbox failed:", e, file=sys.stderr)
                time.sleep(3)
                continue
            for m in got.get("messages", []):
                try:
                    self.report({"type": "run.progress", "runId": m["runId"], "text": "Working"})
                    self.report({"type": "run.end", "runId": m["runId"], "status": "ok", "text": str(handle(m))[:4000]})
                except Exception as e:  # noqa: BLE001
                    try:
                        self.report({"type": "run.end", "runId": m["runId"], "status": "error", "error": str(e)[:300]})
                    except Exception:  # noqa: BLE001
                        pass
            # stops and approvals in got["stops"] / got["approvals"] are for agents that run long jobs


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    agent = MvwAgent(sys.argv[1], sys.argv[2])
    if "--enrol" in sys.argv:
        print(agent.enrol(sys.argv[sys.argv.index("--enrol") + 1]))
    else:
        agent.serve(lambda m: f"You said: {m['text']}")
