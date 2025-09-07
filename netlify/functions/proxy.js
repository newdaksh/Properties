// netlify/functions/proxy.js
// Paste this into netlify/functions/proxy.js and deploy.

exports.handler = async function (event, context) {
  // Prefer the runtime-provided ALLOWED_ORIGIN, otherwise allow any origin.
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
  const originHeader = event.headers && (event.headers.origin || event.headers.Origin);

  // Helper to build CORS headers for every response
  function corsHeaders() {
    // if ALLOWED_ORIGIN is '*' just return '*', otherwise echo the request origin (if matches)
    const allowOrigin = ALLOWED_ORIGIN === '*' ? '*' : (originHeader || ALLOWED_ORIGIN);
    return {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      // allow Authorization so browser can send it (but you don't need to send it from the client)
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-secret',
      'Access-Control-Allow-Credentials': 'true'
    };
  }

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { dealer, customer, amount, dealDate, status } = body;

    if (!dealer || !customer || !amount || !dealDate || !status) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Optional origin check: if ALLOWED_ORIGIN is not '*' and origin header is present, ensure it matches.
    if (ALLOWED_ORIGIN !== '*' && originHeader && originHeader !== ALLOWED_ORIGIN) {
      return {
        statusCode: 403,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Forbidden origin' })
      };
    }

    // Upstream n8n webhook - set via Netlify environment variables
    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    if (!n8nUrl) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Missing N8N_WEBHOOK_URL env var' })
      };
    }

    // Use server-side credentials (do NOT take these from the browser)
    const username = process.env.N8N_USER || '';
    const password = process.env.N8N_PASS || '';
    const auth = username || password ? 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') : null;

    // Forward request to n8n
    const forward = await fetch(n8nUrl, {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        auth ? { 'Authorization': auth } : {}
      ),
      body: JSON.stringify({ dealer, customer, amount, dealDate, status })
    });

    const text = await forward.text();
    if (!forward.ok) {
      return {
        statusCode: 502,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Upstream error', detail: text })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: true, upstream: text })
    };
  } catch (err) {
    console.error('Proxy error', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Server error' })
    };
  }
};
