#!/usr/bin/env python3
"""
Meta AI chat client using the GraphQL SSE API.

Bypasses the DGW binary WebSocket protocol entirely by using the
sendMessageStream GraphQL subscription over HTTP SSE.

Usage:
    python3 meta-chat.py "your message here"
    echo "your message" | python3 meta-chat.py
    python3 meta-chat.py  # interactive mode

Environment:
    META_RD_CHALLENGE - rd_challenge cookie value
    META_ECTO_SESS    - ecto_1_sess cookie value (URL-decoded)
"""
import json, uuid, time, random, sys, os
import requests

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:149.0) Gecko/20100101 Firefox/149.0"
WARMUP_DOC_ID = "e7f802582dbfed8e181b012e010993eb"
SEND_DOC_ID = "62fbc9b911a73008132a4f5333387703"


def get_cookies():
    rd = os.environ.get("META_RD_CHALLENGE", "")
    ecto = os.environ.get("META_ECTO_SESS", "")
    return {"rd_challenge": rd, "ecto_1_sess": ecto}


def warmup(cookies, conv_id):
    requests.post("https://meta.ai/api/graphql", cookies=cookies,
        headers={"User-Agent": UA, "Origin": "https://meta.ai", "Content-Type": "application/json"},
        json={"doc_id": WARMUP_DOC_ID, "variables": {"conversationId": conv_id}},
        timeout=10)


def unique_message_id():
    now = int(time.time() * 1000)
    rb = random.getrandbits(22)
    return str(((2199023255551 & now) << 22) | rb)


def send_message(cookies, conv_id, message, is_new=True):
    """Send a message and yield streaming response text chunks."""
    turn_id = str(uuid.uuid4())
    
    r = requests.post("https://meta.ai/api/graphql", cookies=cookies,
        headers={
            "User-Agent": UA,
            "Origin": "https://meta.ai",
            "Content-Type": "application/json",
        },
        json={
            "doc_id": SEND_DOC_ID,
            "variables": {
                "conversationId": conv_id,
                "content": message,
                "userMessageId": str(uuid.uuid4()),
                "assistantMessageId": str(uuid.uuid4()),
                "userUniqueMessageId": unique_message_id(),
                "turnId": turn_id,
            }
        },
        timeout=120)
    
    if r.status_code != 200:
        raise Exception(f"HTTP {r.status_code}: {r.text[:200]}")
    
    # Update cookies from response
    for c in r.cookies:
        cookies[c.name] = c.value
    
    prev_text = ""
    for line in r.text.split("\n"):
        line = line.strip()
        if not line.startswith("data: "):
            continue
        try:
            obj = json.loads(line[6:])
        except json.JSONDecodeError:
            continue
        
        msg = obj.get("data", {}).get("sendMessageStream", {})
        if msg.get("__typename") != "AssistantMessage":
            continue
        
        # Response text is at contentRenderer.unified_response.sections[]
        cr = msg.get("contentRenderer", {})
        ur = cr.get("unified_response", {})
        sections = ur.get("sections", [])
        
        for section in sections:
            prim = section.get("view_model", {}).get("primitive", {})
            tn = prim.get("__typename", "")
            
            if "ThinkingStatus" in tn:
                if prim.get("is_in_progress"):
                    thought = prim.get("thought_text") or prim.get("title", "")
                    if thought:
                        yield {"type": "thinking", "text": thought}
                else:
                    yield {"type": "thinking_done"}
            
            elif "MarkdownText" in tn:
                text = prim.get("text", "")
                if text and text != prev_text:
                    if text.startswith(prev_text):
                        delta = text[len(prev_text):]
                        if delta:
                            yield {"type": "text", "delta": delta, "full": text}
                    else:
                        yield {"type": "text", "delta": text, "full": text}
                    prev_text = text
        
        if msg.get("streamingState") == "DONE" and prev_text:
            yield {"type": "done", "full": prev_text}
            return


def main():
    cookies = get_cookies()
    if not cookies["rd_challenge"]:
        print("Set META_RD_CHALLENGE and META_ECTO_SESS environment variables", file=sys.stderr)
        sys.exit(1)
    
    # Get message from args or stdin
    if len(sys.argv) > 1:
        messages = [" ".join(sys.argv[1:])]
    elif not sys.stdin.isatty():
        messages = [sys.stdin.read().strip()]
    else:
        messages = None  # interactive mode
    
    conv_id = str(uuid.uuid4())
    warmup(cookies, conv_id)
    
    if messages:
        for msg in messages:
            sys.stderr.write(f"💬 {msg}\n\n")
            for chunk in send_message(cookies, conv_id, msg):
                if chunk["type"] == "thinking":
                    sys.stderr.write(f"\r💭 {chunk['text']}          ")
                elif chunk["type"] == "thinking_done":
                    sys.stderr.write("\r💭 done                    \n")
                elif chunk["type"] == "text":
                    sys.stdout.write(chunk["delta"])
                    sys.stdout.flush()
                elif chunk["type"] == "done":
                    sys.stdout.write("\n")
    else:
        # Interactive mode
        print("Meta AI Chat (Ctrl+C to quit)\n")
        while True:
            try:
                msg = input("You: ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\nBye!")
                break
            if not msg:
                continue
            print()
            for chunk in send_message(cookies, conv_id, msg):
                if chunk["type"] == "thinking":
                    sys.stderr.write(f"\r💭 {chunk['text']}          ")
                elif chunk["type"] == "thinking_done":
                    sys.stderr.write("\r💭 done                    \n")
                elif chunk["type"] == "text":
                    sys.stdout.write(chunk["delta"])
                    sys.stdout.flush()
                elif chunk["type"] == "done":
                    sys.stdout.write("\n\n")


if __name__ == "__main__":
    main()
