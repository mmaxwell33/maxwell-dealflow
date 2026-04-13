import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

/**
 * Web Push edge function — VAPID via Web Crypto API (Deno-native)
 * Sends real background push notifications to Maxwell's subscribed devices.
 *
 * Supabase secrets required:
 *   VAPID_PUBLIC_KEY   – base64url P-256 uncompressed public key (87 chars)
 *   VAPID_PRIVATE_KEY  – base64url P-256 raw private key (43 chars)
 *   VAPID_SUBJECT      – mailto:Maxwell.Midodzi@exprealty.com
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── base64url ────────────────────────────────────────────────────────────────
const b64u = {
  enc: (buf: Uint8Array) =>
    btoa(String.fromCharCode(...buf))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string): Uint8Array => {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - s.length % 4);
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    return Uint8Array.from(b, c => c.charCodeAt(0));
  },
};

// ── Build VAPID Authorization header ────────────────────────────────────────
async function vapidAuth(
  endpoint: string,
  pubKeyRaw: Uint8Array,   // 65-byte uncompressed P-256
  privKeyRaw: Uint8Array,  // 32-byte raw P-256 private key
  subject: string,
): Promise<string> {
  const url  = new URL(endpoint);
  const aud  = `${url.protocol}//${url.host}`;
  const now  = Math.floor(Date.now() / 1000);

  const header  = b64u.enc(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u.enc(new TextEncoder().encode(JSON.stringify({ aud, exp: now + 43200, sub: subject })));
  const msg     = new TextEncoder().encode(`${header}.${payload}`);

  // Import private key as PKCS8 (Deno requires this format for ECDSA signing)
  // Build minimal PKCS8 DER for a raw 32-byte P-256 private key
  const pkcs8 = buildPkcs8(privKeyRaw);
  const signingKey = await crypto.subtle.importKey(
    'pkcs8', pkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign'],
  );

  const sigDer = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, msg);
  const sig    = b64u.enc(derToIeee(new Uint8Array(sigDer)));
  const jwt    = `${header}.${payload}.${sig}`;

  const pubB64 = b64u.enc(pubKeyRaw);
  return `vapid t=${jwt},k=${pubB64}`;
}

// Build a PKCS8 DER wrapper around a 32-byte raw P-256 private key
function buildPkcs8(rawKey: Uint8Array): ArrayBuffer {
  // ECPrivateKey SEQUENCE { version INTEGER 1, privateKey OCTET STRING(32) }
  const ecPriv = new Uint8Array([
    0x30, 0x25,          // SEQUENCE len=37
    0x02, 0x01, 0x01,    //   INTEGER version=1
    0x04, 0x20,          //   OCTET STRING len=32
    ...rawKey,           //   (32 bytes of raw private key)
  ]);
  // OneAsymmetricKey SEQUENCE {
  //   version INTEGER 0,
  //   algorithm AlgorithmIdentifier { ecPublicKey, P-256 },
  //   privateKey OCTET STRING(ecPriv)
  // }
  const pkcs8 = new Uint8Array([
    0x30, 0x41,          // SEQUENCE len=65
    0x02, 0x01, 0x00,    //   INTEGER version=0
    0x30, 0x13,          //   SEQUENCE len=19 (AlgorithmIdentifier)
    0x06, 0x07,          //     OID len=7
    0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,  // ecPublicKey
    0x06, 0x08,          //     OID len=8
    0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,  // P-256
    0x04, 0x27,          //   OCTET STRING len=39
    ...ecPriv,
  ]);
  return pkcs8.buffer;
}

// Convert DER ECDSA signature → IEEE P1363 (raw R‖S, 64 bytes)
function derToIeee(der: Uint8Array): Uint8Array {
  const out = new Uint8Array(64);
  let i = 2;                          // skip SEQUENCE tag+len
  const rLen = der[i + 1]; i += 2;
  const r = der.slice(i + (der[i] === 0 ? 1 : 0), i + rLen); i += rLen;
  const sLen = der[i + 1]; i += 2;
  const s = der.slice(i + (der[i] === 0 ? 1 : 0), i + sLen);
  out.set(r.slice(-32), 32 - Math.min(r.length, 32));
  out.set(s.slice(-32), 64 - Math.min(s.length, 32));
  return out;
}

// ── Encrypt push payload (RFC 8291 aesgcm) ───────────────────────────────────
async function encryptPayload(plaintext: string, p256dh: Uint8Array, auth: Uint8Array) {
  const salt      = crypto.getRandomValues(new Uint8Array(16));
  const serverKP  = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPub = new Uint8Array(await crypto.subtle.exportKey('raw', serverKP.publicKey));

  const clientPubKey = await crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedBits   = await crypto.subtle.deriveBits({ name: 'ECDH', public: clientPubKey }, serverKP.privateKey, 256);
  const sharedSecret = new Uint8Array(sharedBits);

  // HKDF-extract with auth as salt
  const prk = await hkdfExtract(auth, sharedSecret);

  // Content-Encoding info strings
  const enc = new TextEncoder();
  const keyInfo   = buildInfo(enc.encode('aesgcm'), p256dh, serverPub);
  const nonceInfo = buildInfo(enc.encode('nonce'),  p256dh, serverPub);

  const key   = await hkdfExpand(prk, salt, keyInfo, 16);
  const nonce = await hkdfExpand(prk, salt, nonceInfo, 12);

  const aesKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);

  // Prepend 2-byte padding length (0)
  const data = new Uint8Array(2 + enc.encode(plaintext).length);
  data.set(enc.encode(plaintext), 2);

  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, data));
  return { ciphertext: ct, salt, serverPub };
}

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm));
}

async function hkdfExpand(prk: Uint8Array, salt: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HKDF' }, false, ['deriveBits']);
  const bits   = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    prkKey, len * 8,
  );
  return new Uint8Array(bits);
}

function buildInfo(type: Uint8Array, clientKey: Uint8Array, serverKey: Uint8Array): Uint8Array {
  // "Content-Encoding: <type>\0" + "P-256\0" + uint16(clientKey.length) + clientKey + uint16(serverKey.length) + serverKey
  const prefix = new TextEncoder().encode('Content-Encoding: ');
  const p256   = new TextEncoder().encode('P-256\0');
  const buf = new Uint8Array(
    prefix.length + type.length + 1 +
    1 + p256.length +
    2 + clientKey.length +
    2 + serverKey.length,
  );
  let o = 0;
  buf.set(prefix, o); o += prefix.length;
  buf.set(type,   o); o += type.length;
  buf[o++] = 0;   // null terminator
  buf[o++] = 0;   // context prefix
  buf.set(p256, o); o += p256.length;
  buf[o++] = 0; buf[o++] = clientKey.length;
  buf.set(clientKey, o); o += clientKey.length;
  buf[o++] = 0; buf[o++] = serverKey.length;
  buf.set(serverKey, o);
  return buf;
}

// ── Send one push notification ────────────────────────────────────────────────
async function sendOne(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: object,
  pubKeyRaw: Uint8Array,
  privKeyRaw: Uint8Array,
  subject: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const p256dh = b64u.dec(sub.keys.p256dh);
  const auth   = b64u.dec(sub.keys.auth);
  const { ciphertext, salt, serverPub } = await encryptPayload(JSON.stringify(payload), p256dh, auth);

  const authHeader = await vapidAuth(sub.endpoint, pubKeyRaw, privKeyRaw, subject);

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization':    authHeader,
      'Content-Type':     'application/octet-stream',
      'Content-Encoding': 'aesgcm',
      'Encryption':       `salt=${b64u.enc(salt)}`,
      'Crypto-Key':       `dh=${b64u.enc(serverPub)};p256ecdsa=${b64u.enc(pubKeyRaw)}`,
      'TTL':              '86400',
    },
    body: ciphertext,
  });

  const body = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, body };
}

// ── Main ─────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { title, body, tab = 'approvals', subscriptions } = await req.json();
    if (!title || !subscriptions?.length) {
      return new Response(JSON.stringify({ error: 'title + subscriptions required' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const PUB  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? '';
    const PRIV = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
    const SUB  = Deno.env.get('VAPID_SUBJECT')     ?? 'mailto:Maxwell.Midodzi@exprealty.com';

    if (!PUB || !PRIV) {
      return new Response(JSON.stringify({ error: 'VAPID secrets not set' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const pubKeyRaw  = b64u.dec(PUB);
    const privKeyRaw = b64u.dec(PRIV);

    const results = await Promise.allSettled(
      subscriptions.map((s: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
        sendOne(s, { title, body, tab, icon: '/icons/icon-192.png' }, pubKeyRaw, privKeyRaw, SUB)
      )
    );

    const detail = results.map((r, i) =>
      r.status === 'fulfilled'
        ? { i, ok: r.value.ok, status: r.value.status, body: r.value.body }
        : { i, ok: false, error: String((r as PromiseRejectedResult).reason) }
    );

    const sent = detail.filter(d => d.ok).length;
    return new Response(JSON.stringify({ sent, total: subscriptions.length, detail }),
      { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
