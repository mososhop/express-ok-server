const crypto = require('crypto');

const BASE_URL = process.env.SERVER_URL || 'https://express-ok-server.onrender.com';

// PKCE S256: base64url(SHA256(verifier))
function checkPKCE(verifier, challenge, method) {
  if (method === 'plain') return verifier === challenge;
  const digest = crypto.createHash('sha256').update(verifier).digest();
  return Buffer.from(digest).toString('base64url') === challenge;
}

// Deterministic token based on OAUTH_SECRET – survives server restarts
function computeToken(secret) {
  return crypto.createHmac('sha256', secret).update('mcp-v1').digest('base64url');
}

// Pre-registered OAuth clients (hardcoded for Claude Desktop)
const registeredClients = new Map([
  ['claude-desktop-client', {
    clientId: 'claude-desktop-client',
    redirectUris: ['https://claude.ai/oauth/callback'],
  }],
]);

// Short-lived authorization codes (in-memory, 5 min TTL)
const pendingCodes = new Map();
// In-memory tokens for when OAUTH_SECRET is not set
const issuedTokens = new Set();

function setupOAuthRoutes(app) {
  // OAuth 2.0 discovery (RFC 8414) – Claude Desktop reads this first
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: BASE_URL,
      authorization_endpoint: `${BASE_URL}/oauth/authorize`,
      token_endpoint: `${BASE_URL}/oauth/token`,
      registration_endpoint: `${BASE_URL}/oauth/register`,
      revocation_endpoint: `${BASE_URL}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  // Dynamic Client Registration (RFC 7591) – Claude Desktop calls this automatically
  app.post('/oauth/register', (req, res) => {
    const { redirect_uris, client_name } = req.body || {};

    // Always return 'claude-desktop-client' as the fixed client ID for this personal server
    const clientId = 'claude-desktop-client';

    registeredClients.set(clientId, {
      clientId,
      redirectUris: redirect_uris || ['https://claude.ai/oauth/callback'],
      clientName: client_name || 'Claude Desktop',
    });

    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirect_uris || ['https://claude.ai/oauth/callback'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  // Authorization endpoint – auto-approves; redirect_uri locked to claude.ai for safety
  app.get('/oauth/authorize', (req, res) => {
    const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.query;

    if (response_type !== 'code') {
      return res.status(400).send('unsupported_response_type');
    }
    if (!code_challenge) {
      return res.status(400).send('PKCE code_challenge required');
    }
    if (!redirect_uri || !redirect_uri.startsWith('https://claude.ai/')) {
      return res.status(400).send('invalid_redirect_uri');
    }

    const code = crypto.randomBytes(24).toString('base64url');
    pendingCodes.set(code, {
      clientId: client_id || 'claude-desktop-client',
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method || 'S256',
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // Purge expired codes
    for (const [k, v] of pendingCodes) {
      if (Date.now() > v.expiresAt) pendingCodes.delete(k);
    }

    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set('code', code);
    if (state) callbackUrl.searchParams.set('state', state);

    res.redirect(302, callbackUrl.toString());
  });

  // Token endpoint – code + code_verifier → access_token
  app.post('/oauth/token', (req, res) => {
    const { grant_type, code, redirect_uri, code_verifier } = req.body || {};

    if (grant_type !== 'authorization_code') {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }

    const pending = pendingCodes.get(code);
    if (!pending || Date.now() > pending.expiresAt) {
      pendingCodes.delete(code);
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired or not found' });
    }
    if (pending.redirectUri !== redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    }
    if (!checkPKCE(code_verifier, pending.codeChallenge, pending.codeChallengeMethod)) {
      pendingCodes.delete(code);
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }

    pendingCodes.delete(code);

    const secret = process.env.OAUTH_SECRET;
    let accessToken;
    if (secret) {
      accessToken = computeToken(secret);
    } else {
      accessToken = crypto.randomBytes(32).toString('base64url');
      issuedTokens.add(accessToken);
    }

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3153600, // ~1 year
    });
  });

  // Revocation endpoint
  app.post('/oauth/revoke', (req, res) => {
    const { token } = req.body || {};
    if (token) issuedTokens.delete(token);
    res.status(200).json({});
  });
}

// Middleware for /sse and /messages: accepts Bearer token or legacy X-API-Key
function requireAuth(req, res, next) {
  const secret = process.env.OAUTH_SECRET;
  const apiKey = process.env.MCP_API_KEY;

  // Dev mode: no auth configured at all
  if (!secret && !apiKey) return next();

  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  // Deterministic Bearer token (requires OAUTH_SECRET)
  if (secret && bearerToken && bearerToken === computeToken(secret)) return next();

  // In-memory Bearer token (fallback when OAUTH_SECRET not set)
  if (!secret && bearerToken && issuedTokens.has(bearerToken)) return next();

  // Backwards-compatible X-API-Key header
  if (apiKey && req.headers['x-api-key'] === apiKey) return next();

  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { setupOAuthRoutes, requireAuth };
