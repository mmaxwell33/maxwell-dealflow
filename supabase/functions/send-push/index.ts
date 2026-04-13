import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

/**
 * Web Push edge function — sends real push notifications to all of Maxwell's
 * subscribed devices (iPhone + Mac browser) even when the app is closed.
 *
 * Uses VAPID (Voluntary Application Server Identification) — the standard
 * for sending web push without a third-party service like Firebase.
 *
 * Required Supabase secrets:
 *   VAPID_PUBLIC_KEY   – base64url-encoded P-256 uncompressed public key
 *   VAPID_PRIVATE_KEY  – base64url-encoded P-256 private key (32 bytes)
 *   VAPID_SUBJECT      – mailto: or https: contact (e.g. mailto:Maxwell.Midodzi@exprealty.com)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Base64url helpers ─────────────────────────────────────────────────────────
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function b64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Build VAPID JWT for the push endpoint ────────────────────────────────────
async function buildVapidJwt(audience: string, subject: string, privateKeyBytes: Uint8Array): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', typ: 'JWT' };
  const payload = { aud: audience, exp: now + 12 * 3600, sub: subject };

  const enc = new TextEncoder();
  const headerB64  = b64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sigInput   = enc.encode(`${headerB64}.${payloadB64}`);

  // Import the raw P-256 private key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    privateKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  ).catch(async () => {
    // Some runtimes prefer pkcs8 import for signing
    // Build minimal PKCS8 wrapper around the raw 32-byte key
    const pkcs8Header = new Uint8Array([
      0x30,0x41, 0x02,0x01,0x00,
      0x30,0x13, 0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,
                 0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,
      0x04,0x27, 0x30,0x25, 0x02,0x01,0x01, 0x04,0x20,
      ...privateKeyBytes
    ]);
    return crypto.subtle.importKey('pkcs8', pkcs8Header, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  });

  // Sign — try ECDSA path (standard for JWT ES256)
  let signingKey: CryptoKey;
  try {
    signingKey = await crypto.subtle.importKey(
      'pkcs8',
      buildPkcs8(privateKeyBytes),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );
  } catch {
    throw new Error('Failed to import VAPID private key for signing');
  }

  const sigDer = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, sigInput);

  // DER → raw R||S (IEEE P1363 format required by JWT ES256)
  const sig = derToRawSignature(new Uint8Array(sigDer));
  return `${headerB64}.${payloadB64}.${b64urlEncode(sig)}`;
}

// Build a minimal PKCS8 DER wrapper for a 32-byte P-256 private key
function buildPkcs8(rawKey: Uint8Array): ArrayBuffer {
  // ECPrivateKey (RFC 5915) wrapped in PKCS8 (RFC 5958)
  const ecPrivKey = new Uint8Array([
    0x30, 0x25,           // SEQUENCE
      0x02, 0x01, 0x01,   // INTEGER version = 1
      0x04, 0x20,         // OCTET STRING, 32 bytes
      ...rawKey
  ]);
  const pkcs8 = new Uint8Array([
    0x30, 0x41,           // SEQUENCE
      0x02, 0x01, 0x00,   // INTEGER version = 0
      0x30, 0x13,         // SEQUENCE (AlgorithmIdentifier)
        0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,  // OID ecPublicKey
        0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, // OID P-256
      0x04, 0x27,         // OCTET STRING
        ...ecPrivKey
  ]);
  return pkcs8.buffer;
}

// Convert DER-encoded ECDSA signature to raw R||S (64 bytes)
function derToRawSignature(der: Uint8Array): Uint8Array {
  let offset = 2; // skip SEQUENCE tag + length
  const rLen = der[offset + 1];
  const rStart = offset + 2 + (der[offset + 2] === 0 ? 1 : 0);
  const r = der.slice(rStart, offset + 2 + rLen);
  offset += 2 + rLen;
  const sLen = der[offset + 1];
  const sStart = offset + 2 + (der[offset + 2] === 0 ? 1 : 0);
  const s = der.slice(sStart, offset + 2 + sLen);
  const out = new Uint8Array(64);
  out.set(r.slice(-32), 32 - Math.min(r.length, 32));
  out.set(s.slice(-32), 64 - Math.min(s.length, 32));
  return out;
}

// ── Encrypt the push payload using Web Push content encryption (AES-128-GCM) ─
async function encryptPayload(
  payload: string,
  clientPublicKeyBytes: Uint8Array,
  authBytes: Uint8Array
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Generate ephemeral server key pair
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  // Import client's public key
  const clientKey = await crypto.subtle.importKey(
    'raw',
    clientPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // ECDH shared secret
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey },
    serverKeyPair.privateKey,
    256
  );

  // Export server public key (uncompressed)
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeyPair.publicKey));

  // HKDF to derive content encryption key and nonce (RFC 8291)
  const enc = new TextEncoder();
  const prk = await hkdf(
    new Uint8Array(sharedBits),
    authBytes,
    enc.encode('Content-Encoding: auth\0'),
    32
  );

  const keyInfo   = buildInfo('aesgcm', clientPublicKeyBytes, serverPubRaw);
  const nonceInfo = buildInfo('nonce', clientPublicKeyBytes, serverPubRaw);

  const contentKey = await hkdf(prk, salt, keyInfo, 16);
  const nonce      = await hkdf(prk, salt, nonceInfo, 12);

  // Import AES key and encrypt
  const aesKey = await crypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const plaintext = enc.encode(payload);
  // Prepend 2-byte padding length (0) per RFC 8291
  const padded = new Uint8Array(2 + plaintext.length);
  padded.set(plaintext, 2);

  const ciphertextBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded);

  return { ciphertext: new Uint8Array(ciphertextBuf), salt, serverPublicKey: serverPubRaw };
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const ikmKey = await crypto.subtle.importKey('raw', ikm, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', ikmKey, salt));
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HKDF' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info },
    prkKey,
    length * 8
  );
  return new Uint8Array(bits);
}

function buildInfo(type: string, clientKey: Uint8Array, serverKey: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const label = enc.encode(`Content-Encoding: ${type}\0`);
  const context = new Uint8Array(5 + clientKey.length + serverKey.length);
  const prefix = enc.encode('P-256\0');
  // Build: label || 0x00 || "P-256" || 0x00 || len(clientKey) || clientKey || len(serverKey) || serverKey
  const info = new Uint8Array(
    label.length + 1 +
    prefix.length +
    2 + clientKey.length +
    2 + serverKey.length
  );
  let pos = 0;
  info.set(label, pos); pos += label.length;
  info[pos++] = 0;
  info.set(prefix, pos); pos += prefix.length;
  info[pos++] = 0; info[pos++] = clientKey.length;
  info.set(clientKey, pos); pos += clientKey.length;
  info[pos++] = 0; info[pos++] = serverKey.length;
  info.set(serverKey, pos);
  return info;
}

// ── Send a single push notification to one subscription ─────────────────────
async function sendPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: { title: string; body: string; tab?: string; icon?: string },
  vapidPublicKey: Uint8Array,
  vapidPrivateKeyBytes: Uint8Array,
  subject: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const jwt = await buildVapidJwt(audience, subject, vapidPrivateKeyBytes);
  const vapidAuthHeader = `vapid t=${jwt},k=${b64urlEncode(vapidPublicKey)}`;

  const clientPubKey = b64urlDecode(subscription.keys.p256dh);
  const authSecret   = b64urlDecode(subscription.keys.auth);

  const payloadStr = JSON.stringify(payload);
  const { ciphertext, salt, serverPublicKey } = await encryptPayload(payloadStr, clientPubKey, authSecret);

  const resp = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': vapidAuthHeader,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aesgcm',
      'Encryption': `salt=${b64urlEncode(salt)}`,
      'Crypto-Key': `dh=${b64urlEncode(serverPublicKey)};p256ecdsa=${b64urlEncode(vapidPublicKey)}`,
      'TTL': '86400',
    },
    body: ciphertext,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { ok: false, status: resp.status, error: text };
  }
  return { ok: true, status: resp.status };
}

// ── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { title, body, tab = 'approvals', subscriptions } = await req.json();

    if (!title || !body || !subscriptions?.length) {
      return new Response(JSON.stringify({ error: 'title, body and subscriptions required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')  || '';
    const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';
    const VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT')     || 'mailto:Maxwell.Midodzi@exprealty.com';

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response(JSON.stringify({ error: 'VAPID keys not configured in Supabase secrets' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const pubKeyBytes  = b64urlDecode(VAPID_PUBLIC_KEY);
    const privKeyBytes = b64urlDecode(VAPID_PRIVATE_KEY);

    const results = await Promise.allSettled(
      subscriptions.map((sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
        sendPush(sub, { title, body, tab, icon: '/icons/icon-192.png' }, pubKeyBytes, privKeyBytes, VAPID_SUBJECT)
      )
    );

    const summary = results.map((r, i) =>
      r.status === 'fulfilled'
        ? { sub: i, ok: r.value.ok, status: r.value.status, error: r.value.error }
        : { sub: i, ok: false, error: String((r as PromiseRejectedResult).reason) }
    );

    return new Response(JSON.stringify({ sent: summary.filter(s => s.ok).length, total: subscriptions.length, detail: summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
