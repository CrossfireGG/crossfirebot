import crypto from 'node:crypto';
import http from 'node:http';

const MAX_BODY_BYTES = 1024 * 1024;

export function startWebhookServer(config, handlers = {}) {
  if (!config.port) {
    console.log('Webhook server disabled: PORT/WEBHOOK_PORT is not configured');
    return null;
  }

  const webhookPath = normalizePath(config.sclWebhookPath);
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method !== 'POST' || url.pathname !== webhookPath) {
        sendJson(response, 404, { error: 'not_found' });
        return;
      }

      const body = await readJsonBody(request);
      verifySclWebhook(request.headers.authorization, config.sclWebhookSecret);

      if (body.event !== 'demo_ready') {
        sendJson(response, 202, { ok: true, ignored: true });
        return;
      }

      await handlers.onSclDemoReady?.(body);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      const status = error.statusCode || 500;
      console.error('Webhook failed:', error);
      sendJson(response, status, { error: error.message });
    }
  });

  server.listen(config.port, () => {
    console.log(`Webhook server listening on port ${config.port}`);
    console.log(`SCL webhook path: ${webhookPath}`);
  });

  return server;
}

function normalizePath(value) {
  const path = String(value || '/webhooks/scl').trim();
  return path.startsWith('/') ? path : `/${path}`;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        const error = new Error('Request body is too large');
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error('Invalid JSON body');
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function verifySclWebhook(authorization, secret) {
  if (!secret) {
    const error = new Error('SCL_WEBHOOK_SECRET is not configured');
    error.statusCode = 503;
    throw error;
  }

  const token = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    const error = new Error('Missing SCL webhook authorization');
    error.statusCode = 401;
    throw error;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    const error = new Error('Invalid SCL webhook token');
    error.statusCode = 401;
    throw error;
  }

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = base64Url(crypto
    .createHmac('sha256', secret)
    .update(signatureInput)
    .digest());
  if (!timingSafeEqual(encodedSignature, expectedSignature)) {
    const error = new Error('Invalid SCL webhook signature');
    error.statusCode = 401;
    throw error;
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  if (payload.iss !== 'scl') {
    const error = new Error('Invalid SCL webhook issuer');
    error.statusCode = 401;
    throw error;
  }

  const issuedAt = Number(payload.iat || 0);
  const expiresAt = Number(payload.exp || 0);
  const now = Math.floor(Date.now() / 1000);
  if ((issuedAt && now - issuedAt > 15) || (expiresAt && now > expiresAt)) {
    const error = new Error('Expired SCL webhook token');
    error.statusCode = 401;
    throw error;
  }
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}
