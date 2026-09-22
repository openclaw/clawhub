#!/usr/bin/env python3
import hashlib
import http.server
import json
import pathlib
import sys
import threading


events_path = pathlib.Path(sys.argv[1])
port_path = pathlib.Path(sys.argv[2])
tarball_path = pathlib.Path(sys.argv[3])
expected_canaries = sys.argv[4:]


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def do_GET(self):
        authorization = self.headers.get("Authorization", "")
        event = {
            "path": self.path,
            "authorization_present": bool(authorization),
            "authorization_sha256": hashlib.sha256(authorization.encode()).hexdigest()
            if authorization
            else None,
            "contains_expected_synthetic_canary": any(
                canary in authorization for canary in expected_canaries
            ) if authorization else False,
        }
        with events_path.open("a") as events:
            events.write(json.dumps(event, sort_keys=True) + "\n")

        if self.path == "/credential-probe-pkg":
            host = self.headers["Host"]
            tarball = tarball_path.read_bytes()
            body = json.dumps(
                {
                    "name": "credential-probe-pkg",
                    "dist-tags": {"latest": "1.0.0"},
                    "versions": {
                        "1.0.0": {
                            "_id": "credential-probe-pkg@1.0.0",
                            "name": "credential-probe-pkg",
                            "version": "1.0.0",
                            "dist": {
                                "tarball": f"http://{host}/credential-probe-pkg/-/credential-probe-pkg-1.0.0.tgz",
                                "shasum": hashlib.sha1(tarball).hexdigest(),
                            },
                        }
                    },
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path == "/credential-probe-pkg/-/credential-probe-pkg-1.0.0.tgz":
            body = tarball_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_response(404)
        self.end_headers()


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
port_path.write_text(str(server.server_address[1]) + "\n")
threading.Thread(target=server.serve_forever, daemon=False).start()
