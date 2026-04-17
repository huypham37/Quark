"""
meta-sniffer.py — mitmproxy addon to capture meta.ai DGW WebSocket traffic

Usage:
    mitmdump -s scripts/proxy/meta-sniffer.py -p 8081
"""

import json
import os
import re
import base64
from mitmproxy import http

WS_DUMP_DIR = "/tmp/meta-ws-dump"
os.makedirs(WS_DUMP_DIR, exist_ok=True)


class MetaSniffer:
    def __init__(self):
        self.ws_msg_count = 0

    def _is_target(self, host):
        return any(d in host for d in ["meta.ai", "gateway.meta", "graph.meta", "facebook.com"])

    def _is_static(self, url):
        return "/_next/static/" in url or any(url.endswith(ext) for ext in
            [".js", ".css", ".png", ".jpg", ".woff", ".woff2", ".svg", ".ico", ".map"])

    def request(self, flow: http.HTTPFlow):
        host = flow.request.pretty_host
        if not self._is_target(host):
            return
        url = flow.request.pretty_url
        if self._is_static(url):
            return

        method = flow.request.method
        print(f"\n{'='*70}", flush=True)
        print(f"  {method} {url}", flush=True)
        print(f"{'='*70}", flush=True)

        for key, val in flow.request.headers.items():
            if key.lower() in ("cookie",):
                print(f"  {key}: {val[:150]}...", flush=True)
            else:
                print(f"  {key}: {val}", flush=True)

        if method == "POST":
            try:
                text = flow.request.get_text()
                if text:
                    print(f"\n  Body ({len(text)} chars):\n{text[:3000]}{'...' if len(text)>3000 else ''}", flush=True)
            except Exception as e:
                print(f"  Body error: {e}", flush=True)

    def responseheaders(self, flow: http.HTTPFlow):
        host = flow.request.pretty_host
        if not self._is_target(host):
            return
        url = flow.request.pretty_url
        if self._is_static(url):
            return
        status = flow.response.status_code
        content_type = flow.response.headers.get("content-type", "")
        print(f"\n  >>> Response headers: {status} | {content_type}", flush=True)

    def response(self, flow: http.HTTPFlow):
        host = flow.request.pretty_host
        if not self._is_target(host):
            return
        url = flow.request.pretty_url
        if self._is_static(url):
            return
        status = flow.response.status_code
        content_type = flow.response.headers.get("content-type", "")
        print(f"\n  >>> Response: {status} | {content_type}", flush=True)
        try:
            text = flow.response.get_text()
            if text:
                print(f"  Body ({len(text)} chars):\n{text[:3000]}{'...' if len(text)>3000 else ''}", flush=True)
        except Exception:
            print(f"  [binary, {len(flow.response.content)} bytes]", flush=True)

    def websocket_start(self, flow: http.HTTPFlow):
        print(f"\n{'#'*70}", flush=True)
        print(f"  WS CONNECT: {flow.request.pretty_url}", flush=True)
        print(f"{'#'*70}", flush=True)
        for key, val in flow.request.headers.items():
            if key.lower() in ("cookie",):
                print(f"  {key}: {val[:150]}...", flush=True)
            else:
                print(f"  {key}: {val}", flush=True)

    def websocket_message(self, flow: http.HTTPFlow):
        host = flow.request.pretty_host
        if not self._is_target(host):
            return

        assert flow.websocket is not None
        message = flow.websocket.messages[-1]
        direction = "CLIENT" if message.from_client else "SERVER"
        content = message.content
        self.ws_msg_count += 1
        
        # Save raw binary to file
        fname = f"{self.ws_msg_count:04d}_{direction}.bin"
        fpath = os.path.join(WS_DUMP_DIR, fname)
        with open(fpath, 'wb') as f:
            f.write(content if isinstance(content, bytes) else content.encode())

        # Try to decode
        if isinstance(content, bytes):
            # Look for JSON inside binary frame
            json_start = content.find(b'{')
            if json_start >= 0:
                text = content[json_start:].decode('utf-8', errors='replace')
                print(f"\n  WS {direction} #{self.ws_msg_count} [binary {len(content)}b, hdr={content[:json_start].hex()}]", flush=True)
                
                # Try to parse JSON and decode payload
                try:
                    obj = json.loads(text)
                    req_id = obj.get('req-id', '')
                    payload_b64 = obj.get('payload', '')
                    if payload_b64:
                        try:
                            payload_bytes = base64.b64decode(payload_b64 + '==')
                            # Extract readable strings from protobuf
                            readable = re.findall(rb'[\x20-\x7e]{4,}', payload_bytes)
                            print(f"    req-id: {req_id}", flush=True)
                            print(f"    payload ({len(payload_bytes)} bytes) readable strings:", flush=True)
                            for s in readable:
                                print(f"      {s.decode()}", flush=True)
                            # Also save decoded payload
                            with open(fpath + '.payload', 'wb') as f:
                                f.write(payload_bytes)
                        except Exception:
                            print(f"    req-id: {req_id}", flush=True)
                            print(f"    payload (raw b64): {payload_b64[:200]}...", flush=True)
                    else:
                        print(f"    {text[:500]}", flush=True)
                except json.JSONDecodeError:
                    print(f"    {text[:500]}", flush=True)
            else:
                # Pure binary
                readable = re.findall(rb'[\x20-\x7e]{4,}', content)
                print(f"\n  WS {direction} #{self.ws_msg_count} [binary {len(content)}b]", flush=True)
                if readable:
                    for s in readable[:10]:
                        print(f"    {s.decode()}", flush=True)
        else:
            # Text frame
            print(f"\n  WS {direction} #{self.ws_msg_count} [text {len(content)} chars]:", flush=True)
            print(f"    {content[:500]}", flush=True)

    def websocket_end(self, flow: http.HTTPFlow):
        print(f"\n  WS CLOSED: {flow.request.pretty_url}", flush=True)


addons = [MetaSniffer()]
