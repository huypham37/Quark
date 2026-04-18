#!/usr/bin/env node
/**
 * Meta.ai CLI chat client using the DGW WASM codec.
 * 
 * Architecture:
 *   1. Fetches access token from meta.ai HTML
 *   2. Warms up conversation via GraphQL
 *   3. Loads Meta's DGW WASM codec (asm.js fallback) from their JS bundles
 *   4. Uses Python+blackboxprotobuf to construct the protobuf chat payload
 *   5. Encodes frames with the DGW codec and sends over WebSocket
 *   6. Decodes streaming response frames and extracts JSON from protobuf wrapper
 *
 * Requirements: node (with ws package), python3 (with blackboxprotobuf)
 * Usage: node meta-chat.js "your message here"
 */

const https = require('https');
const { URL, URLSearchParams } = require('url');
const crypto = require('crypto');
const WebSocket = require('ws');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// ── Config ──
const COOKIE_RD = process.env.META_RD_CHALLENGE || "";
const COOKIE_ECTO = process.env.META_ECTO_SESS || "";
const COOKIE = `rd_challenge=${COOKIE_RD}; ecto_1_sess=${COOKIE_ECTO}`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:149.0) Gecko/20100101 Firefox/149.0";
const TEMPLATE_PATH = process.env.META_TEMPLATE || path.join(__dirname, 'meta-ws-template.bin');
const PROTO_GEN = path.join(__dirname, 'meta-proto-gen.py');

// ── HTTP helpers ──
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': UA, 'Cookie': COOKIE }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: {
        'User-Agent': UA, 'Cookie': COOKIE,
        'Content-Type': 'application/json', 'Origin': 'https://meta.ai',
        'Content-Length': Buffer.byteLength(payload),
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── DGW Codec ──
async function loadCodec() {
  const res = await httpGet('https://meta.ai/_next/static/chunks/17128583064c201d.js?dpl=dpl_AYEU38d4RvUrVrACKXy76tsjnUdk');
  const code = res.data;
  const marker = 'function(r){var e,t,a,i,f,o,u,c,l,A,s,r=void 0';
  const start = code.indexOf(marker);
  if (start < 0) throw new Error('Codec factory not found');
  let depth = 0, end = -1;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const factory = new Function('n', 'return (' + code.substring(start, end) + ')')(undefined);
  return await factory();
}

function createCodecHelpers(codec) {
  const { HEAPU8, HEAPU32, __malloc: malloc, __free: free } = codec;
  
  return {
    encodeEstablishStream(streamId, params) {
      const b = new TextEncoder().encode(JSON.stringify(params));
      const ptr = malloc(b.length), out = malloc(8);
      HEAPU8.set(b, ptr);
      const ret = codec.__DgwCodecEncodeStreamGroup_EstabStream(streamId, ptr, b.length, out, out + 4);
      free(ptr);
      if (ret !== 0) { free(out); return null; }
      const r = new Uint8Array(HEAPU8.subarray(HEAPU32[out/4], HEAPU32[out/4] + HEAPU32[out/4+1]));
      free(HEAPU32[out/4]); free(out);
      return r;
    },

    encodeData(streamId, data, requiresAck, ackId) {
      const ptr = malloc(data.length), out = malloc(8);
      HEAPU8.set(data, ptr);
      const ret = codec.__DgwCodecEncodeStreamGroup_Data(streamId, ptr, data.length, requiresAck ? 1 : 0, ackId, out, out + 4);
      free(ptr);
      if (ret !== 0) { free(out); return null; }
      const r = new Uint8Array(HEAPU8.subarray(HEAPU32[out/4], HEAPU32[out/4] + HEAPU32[out/4+1]));
      free(HEAPU32[out/4]); free(out);
      return r;
    },

    encodeAck(streamId, ackId) {
      const out = malloc(8);
      const ret = codec.__DgwCodecEncodeStreamGroup_Ack(streamId, ackId, out, out + 4);
      if (ret !== 0) { free(out); return null; }
      const r = new Uint8Array(HEAPU8.subarray(HEAPU32[out/4], HEAPU32[out/4] + HEAPU32[out/4+1]));
      free(HEAPU32[out/4]); free(out);
      return r;
    },

    encodePing() {
      const out = malloc(8);
      const ret = codec.__DgwCodecEncodePing(out, out + 4);
      if (ret !== 0) { free(out); return null; }
      const r = new Uint8Array(HEAPU8.subarray(HEAPU32[out/4], HEAPU32[out/4] + HEAPU32[out/4+1]));
      free(HEAPU32[out/4]); free(out);
      return r;
    },

    decode(data) {
      const bytes = new Uint8Array(data);
      const ptr = malloc(bytes.length), out = malloc(16);
      HEAPU8.set(bytes, ptr);
      const ret = codec.__DgwCodecDecode(ptr, bytes.length, out, out+4, out+8, out+12);
      free(ptr);
      if (ret !== 0) { free(out); return []; }
      const framesPtr = HEAPU32[out/4], count = HEAPU32[out/4+1];
      free(out);

      const frames = [];
      for (let i = 0; i < count; i++) {
        const fp = codec.__getDGWFramePtr(framesPtr, i);
        const type = codec.__getFrameType(fp);
        let payload = null, ackId = null, sid = null;

        if (type === 13) { // Data
          const dp = codec.__getDataFromGroupedStreamDataFrame(fp);
          const ds = codec.__getDataSizeFromGroupedStreamDataFrame(fp);
          payload = new Uint8Array(HEAPU8.subarray(dp, dp + ds));
          free(dp);
          sid = codec.__getStreamIdFromStreamGroupFrame(fp);
          if (codec.__getRequiresAckFromGroupedStreamDataFrame(fp))
            ackId = codec.__getAckIdFromGroupedStreamDataFrame(fp);
        } else if (type === 15) { // EstabStream
          const pp = codec.__getEncodedParamsFromEstablishStreamFrame(fp);
          const ps = codec.__getEncodedParamsSizeFromEstablishStreamFrame(fp);
          payload = new Uint8Array(HEAPU8.subarray(pp, pp + ps));
          free(pp);
        }
        frames.push({ type, payload, ackId, sid });
        free(fp);
      }
      free(framesPtr);
      return frames;
    }
  };
}

// ── Extract JSON from protobuf-wrapped response ──
function extractJson(buf) {
  for (let off = 0; off < buf.length; off++) {
    if (buf[off] !== 0x7b) continue;
    try {
      const obj = JSON.parse(buf.slice(off).toString('utf8'));
      if (obj.seq !== undefined || obj.type) return obj;
    } catch (e) {
      let d = 0, end = -1;
      for (let j = off; j < buf.length; j++) {
        if (buf[j] === 0x7b) d++;
        else if (buf[j] === 0x7d) { d--; if (d === 0) { end = j + 1; break; } }
      }
      if (end > 0) {
        try {
          const obj = JSON.parse(buf.slice(off, end).toString('utf8'));
          if (obj.seq !== undefined) return obj;
        } catch (e2) {}
      }
    }
  }
  return null;
}

// ── Main ──
async function main() {
  const userMsg = process.argv.slice(2).join(' ') || 'hello';

  // 1. Get token
  process.stderr.write('Fetching token... ');
  const page = await httpGet('https://meta.ai/');
  const m = page.data.match(/accessToken\\":\\"(ecto1:[A-Za-z0-9_\-]+)/);
  if (!m) { console.error('Failed'); process.exit(1); }
  const token = m[1];
  process.stderr.write('OK\n');

  // 2. Warmup
  const convId = crypto.randomUUID();
  const reqId = crypto.randomUUID();
  await httpPost('https://meta.ai/api/graphql', {
    doc_id: 'e7f802582dbfed8e181b012e010993eb',
    variables: { conversationId: convId }
  });

  // 3. Load codec
  process.stderr.write('Loading codec... ');
  const codec = await loadCodec();
  const dgw = createCodecHelpers(codec);
  process.stderr.write('OK\n');

  // 4. Build protobuf payload
  let payloadJson;
  try {
    payloadJson = execSync(
      'python3 -W ignore ' + JSON.stringify(PROTO_GEN) + ' ' +
      JSON.stringify(convId) + ' ' + JSON.stringify(reqId) + ' ' + JSON.stringify(userMsg),
      { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch (e) {
    process.stderr.write('Proto gen failed, using template\n');
    const raw = fs.readFileSync(TEMPLATE_PATH);
    payloadJson = raw.slice(raw.indexOf(0x7b)).toString();
  }
  const payload = new TextEncoder().encode(payloadJson);

  // 5. Connect & send
  const wsUrl = 'wss://gateway.meta.ai/ws/clippy?' + new URLSearchParams({
    'x-dgw-appid': '1522763855472543', 'x-dgw-appversion': '1.0.0',
    'x-dgw-authtype': '15:0', 'x-dgw-version': '5', 'x-dgw-uuid': '0',
    'x-dgw-tier': 'prod', 'Authorization': token,
    'x-dgw-app-origin': 'meta.ai',
    'x-dgw-app-clippy-request-id': crypto.randomUUID(),
    'x-dgw-app-clippy-async': 'true',
  });

  console.log(`🤖 Meta AI`);
  console.log(`You: ${userMsg}\n`);

  const ws = new WebSocket(wsUrl, {
    headers: { 'User-Agent': UA, 'Cookie': COOKIE, 'Origin': 'https://meta.ai' }
  });
  ws.binaryType = 'arraybuffer';

  let collected = '', msgCount = 0, done = false;

  function handleMsg(obj) {
    if (obj.seq === undefined && obj.seq !== 0) return;
    msgCount++;
    const resp = obj.response || {};
    if (obj.type === 'full') {
      for (const s of (resp.sections || [])) {
        const p = s.view_model?.primitive || {};
        const tn = p.__typename || '';
        if (tn.includes('ThinkingStatus')) {
          if (p.is_in_progress) {
            const t = p.thought_text || p.title || '';
            if (t) process.stderr.write(`\r💭 ${t}          `);
          } else {
            process.stderr.write('\r💭 done                    \n');
          }
        } else if (tn.includes('MarkdownText')) {
          collected = p.text || '';
          process.stdout.write(`\r${collected}`);
        }
      }
      if (resp.is_complete) { done = true; ws.close(); }
    } else if (obj.type === 'patch') {
      for (const op of (obj.operations || []))
        if (op.op === 'delta') { collected += op.value || ''; process.stdout.write(op.value || ''); }
    }
  }

  ws.on('open', () => {
    setTimeout(() => {
      const estab = dgw.encodeEstablishStream(0, {
        'x-dgw-app-x-ecto-conversation-id': convId,
        'x-dgw-app-client-payload-type': 'PROTO_INSIDE_JSON',
      });
      const data = dgw.encodeData(0, payload, true, 0);
      if (!estab || !data) { console.error('Encode failed'); ws.close(); return; }
      const combined = new Uint8Array(estab.length + data.length);
      combined.set(estab);
      combined.set(data, estab.length);
      ws.send(combined);
      process.stderr.write('Sent ' + combined.length + 'b\n');
    }, 300);
  });

  ws.on('message', (data) => {
    const b = Buffer.from(data);
    process.stderr.write('R(' + b.length + ') ');
    for (const frame of dgw.decode(data)) {
      if (frame.type === 13 && frame.payload) {
        if (frame.ackId !== null) {
          const ack = dgw.encodeAck(frame.sid, frame.ackId);
          if (ack) ws.send(ack);
        }
        const obj = extractJson(Buffer.from(frame.payload));
        if (obj) handleMsg(obj);
      } else if (frame.type === 14) {
        done = true;
      }
    }
  });

  ws.on('error', (e) => console.error(`\nError: ${e.message}`));
  ws.on('close', () => console.log(`\n\n[${msgCount} messages]`));

  const ka = setInterval(() => {
    if (done || ws.readyState !== WebSocket.OPEN) { clearInterval(ka); return; }
    const p = dgw.encodePing();
    if (p) ws.send(p);
  }, 10000);

  setTimeout(() => { if (!done) { console.log('\n[timeout]'); ws.close(); } }, 90000);
}

main().catch(e => { console.error(e); process.exit(1); });
