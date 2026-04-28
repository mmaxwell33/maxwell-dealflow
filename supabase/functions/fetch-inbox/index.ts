import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Fetch emails from Gmail inbox using OAuth2.
 * Used by the Inbox module to sync client replies into email_inbox.
 *
 * Query params / JSON body:
 *   after_epoch  – Unix timestamp (seconds). Only fetch messages after this.
 *   max_results  – Number of messages to fetch (default 20, max 50).
 *   query        – Optional Gmail search query (e.g. "is:inbox").
 *
 * Required Supabase secrets (same as send-email):
 *   GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 */

interface ParsedEmail {
  gmail_message_id: string;
  gmail_thread_id: string;
  from: string;
  from_email: string;
  to: string;
  subject: string;
  date: string;
  in_reply_to: string | null;
  references: string | null;
  message_id_header: string | null;
  snippet: string;
  body_text: string;
  body_html: string;
}

/** Extract header value by name (case-insensitive) */
function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

/** Extract email address from "Name <email>" format */
function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

/** Decode base64url to string */
function decodeBase64Url(data: string): string {
  try {
    const padded = data.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4;
    const final = pad ? padded + '='.repeat(4 - pad) : padded;
    return decodeURIComponent(
      atob(final)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch {
    return '';
  }
}

/** Recursively extract text and html body from MIME parts */
function extractBody(payload: any): { text: string; html: string } {
  let text = '';
  let html = '';

  if (payload.body?.data) {
    const mimeType = payload.mimeType || '';
    const decoded = decodeBase64Url(payload.body.data);
    if (mimeType === 'text/plain') text = decoded;
    if (mimeType === 'text/html') html = decoded;
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const sub = extractBody(part);
      if (sub.text && !text) text = sub.text;
      if (sub.html && !html) html = sub.html;
    }
  }

  return { text, html };
}

/** Strip HTML tags for plain text fallback */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Accept params from query string or JSON body
    let afterEpoch = 0;
    let maxResults = 20;
    let query = 'is:inbox';

    if (req.method === 'POST') {
      const body = await req.json();
      afterEpoch = body.after_epoch || 0;
      maxResults = Math.min(body.max_results || 20, 50);
      if (body.query) query = body.query;
    } else {
      const url = new URL(req.url);
      afterEpoch = parseInt(url.searchParams.get('after_epoch') || '0');
      maxResults = Math.min(parseInt(url.searchParams.get('max_results') || '20'), 50);
      if (url.searchParams.get('query')) query = url.searchParams.get('query')!;
    }

    const GMAIL_USER = Deno.env.get('GMAIL_USER');
    const CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID');
    const CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET');
    const REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN');

    if (!GMAIL_USER || !CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
      return new Response(JSON.stringify({
        error: 'Gmail OAuth not configured.',
      }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 1: Get access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error('OAuth token failed: ' + JSON.stringify(tokenData));
    }
    const auth = `Bearer ${tokenData.access_token}`;

    // Step 2: Build search query with time filter
    let gmailQuery = query;
    if (afterEpoch > 0) {
      gmailQuery += ` after:${afterEpoch}`;
    }

    // Step 3: List message IDs
    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    listUrl.searchParams.set('q', gmailQuery);
    listUrl.searchParams.set('maxResults', String(maxResults));

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: auth },
    });
    const listData = await listRes.json();

    if (!listRes.ok) {
      // If scope error, return helpful message
      const errMsg = listData.error?.message || JSON.stringify(listData);
      if (errMsg.includes('Insufficient Permission') || errMsg.includes('accessNotConfigured')) {
        return new Response(JSON.stringify({
          error: 'Gmail read permission not granted. Update OAuth token with gmail.readonly scope.',
          needs_scope: true,
        }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error('Gmail list failed: ' + errMsg);
    }

    const messageStubs = listData.messages || [];
    if (messageStubs.length === 0) {
      return new Response(JSON.stringify({ emails: [], count: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 4: Fetch full details for each message (batch)
    const emails: ParsedEmail[] = [];

    // Fetch in parallel, max 10 concurrent
    const chunks: Array<Array<{ id: string; threadId: string }>> = [];
    for (let i = 0; i < messageStubs.length; i += 10) {
      chunks.push(messageStubs.slice(i, i + 10));
    }

    for (const chunk of chunks) {
      const fetches = chunk.map(async (stub: { id: string; threadId: string }) => {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${stub.id}?format=full`,
          { headers: { Authorization: auth } }
        );
        if (!msgRes.ok) return null;
        const msg = await msgRes.json();

        const headers = msg.payload?.headers || [];
        const from = getHeader(headers, 'From');
        const to = getHeader(headers, 'To');
        const subject = getHeader(headers, 'Subject');
        const date = getHeader(headers, 'Date');
        const inReplyTo = getHeader(headers, 'In-Reply-To') || null;
        const references = getHeader(headers, 'References') || null;
        const messageIdHeader = getHeader(headers, 'Message-ID') || getHeader(headers, 'Message-Id') || null;

        const { text, html } = extractBody(msg.payload);
        const bodyText = text || stripHtml(html) || msg.snippet || '';

        return {
          gmail_message_id: msg.id,
          gmail_thread_id: msg.threadId,
          from,
          from_email: extractEmail(from),
          to,
          subject,
          date,
          in_reply_to: inReplyTo,
          references,
          message_id_header: messageIdHeader,
          snippet: msg.snippet || '',
          body_text: bodyText,
          body_html: html,
        } as ParsedEmail;
      });

      const results = await Promise.all(fetches);
      emails.push(...results.filter(Boolean) as ParsedEmail[]);
    }

    return new Response(JSON.stringify({
      emails,
      count: emails.length,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Fetch inbox error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
