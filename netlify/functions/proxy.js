// netlify/functions/proxy.js
// Improved error reporting and fetch timeout for debugging 502 issues.

const DEFAULT_TIMEOUT = 10000; // 10s

exports.handler = async function (event, context) {
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
  const originHeader = event.headers && (event.headers.origin || event.headers.Origin);

  function corsHeaders() {
    const allowOrigin = ALLOWED_ORIGIN === '*' ? '*' : (originHeader || ALLOWED_ORIGIN);
    return {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-secret',
      'Access-Control-Allow-Credentials': 'true'
    };
  }

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const payload = event.body ? JSON.parse(event.body) : {};
    // simple validation
    const { dealer, customer, amount, dealDate, status } = payload;
    if (!dealer || !customer || !amount || !dealDate || !status) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Missing required fields', required: ['dealer','customer','amount','dealDate','status'] })
      };
    }

    // Check env var for upstream URL
    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    if (!n8nUrl) {
      console.error('Missing env: N8N_WEBHOOK_URL');
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Server misconfiguration: missing N8N_WEBHOOK_URL' })
      };
    }

    // Basic auth from env (server-side only)
    const username = process.env.N8N_USER || '';
    const password = process.env.N8N_PASS || '';
    const authHeader = username || password ? 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') : null;

    // Timeout helper for fetch (Node global fetch used by Netlify)
    const timeoutMs = Number(process.env.PROXY_TIMEOUT_MS) || DEFAULT_TIMEOUT;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // Forward request
    const forwardRes = await fetch(n8nUrl, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader ? { 'Authorization': authHeader } : {}),
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const upstreamText = await forwardRes.text().catch((e) => {
      console.error('Error reading upstream response body:', e);
      return '';
    });

    // Log for debugging (Netlify function logs)
    console.log('Upstream call:', { url: n8nUrl, status: forwardRes.status, upstreamText: upstreamText.slice(0, 1000) });

    if (!forwardRes.ok) {
      // Surface upstream status and body to response for easier debugging (non-secret)
      return {
        statusCode: 502,
        headers: corsHeaders(),
        body: JSON.stringify({
          error: 'Upstream returned an error',
          upstreamStatus: forwardRes.status,
          upstreamBody: upstreamText
        })
      };
    }

    // Success
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: true, upstreamStatus: forwardRes.status, upstreamBody: upstreamText })
    };
  } catch (err) {
    // Identify timeout separately
    const isAbort = err.name === 'AbortError' || (err.code === 'ABORT_ERR' || false);
    console.error('Proxy exception:', err);
    return {
      statusCode: 502,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Proxy failed', detail: isAbort ? 'Upstream request timed out' : String(err) })
    };
  }
};
