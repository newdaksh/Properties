// netlify/functions/proxy.js
exports.handler = async function (event, context) {
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { dealer, customer, amount, dealDate, status } = body;
    if (!dealer || !customer || !amount || !dealDate || !status) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Optional origin check
    const origin = event.headers.origin;
    if (ALLOWED_ORIGIN !== '*' && origin && origin !== ALLOWED_ORIGIN) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden origin' }) };
    }

    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    if (!n8nUrl) return { statusCode: 500, body: JSON.stringify({ error: 'Missing N8N_WEBHOOK_URL' }) };

    const username = process.env.N8N_USER || '';
    const password = process.env.N8N_PASS || '';
    const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

    const forward = await fetch(n8nUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': auth
      },
      body: JSON.stringify({ dealer, customer, amount, dealDate, status })
    });

    const text = await forward.text();
    if (!forward.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Upstream error', detail: text }) };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({ ok: true, upstream: text })
    };
  } catch (err) {
    console.error('Proxy error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error' })
    };
  }
};
