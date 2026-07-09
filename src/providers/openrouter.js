// OpenRouter provider — main-process module for fetching API key usage/spend
// and credit balance from OpenRouter's REST API.
//
// This module NEVER throws. Every code path resolves to a result object;
// callers can rely on `ok` to branch instead of wrapping calls in try/catch.
const https = require('https');

// Debug mode: set DEBUG_LOG=1 env var or pass --debug flag to see verbose logs (mirrors main.js/codex.js).
const DEBUG = process.env.DEBUG_LOG === '1' || process.argv.includes('--debug');
function debugLog(...args) {
  if (DEBUG) console.log('[Debug][openrouter]', ...args);
}

const REQUEST_TIMEOUT_MS = 10000;

// Round a number to 4 decimal places. Returns undefined for non-numbers.
function round4(n) {
  if (typeof n !== 'number' || !isFinite(n)) return undefined;
  return Math.round(n * 10000) / 10000;
}

// Pass through a value only if it's a finite number, otherwise undefined.
function num(n) {
  return (typeof n === 'number' && isFinite(n)) ? n : undefined;
}

// GET a JSON endpoint on openrouter.ai with the given bearer token.
// Resolves (never rejects) to:
//   { ok: true, data }
//   { ok: false, error, errorKind }   errorKind: 'auth' | 'network' | 'parse' | 'http'
function httpsGetJson(urlPath, apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'openrouter.ai',
      path: urlPath,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      timeout: REQUEST_TIMEOUT_MS
    };

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const statusCode = res.statusCode || 0;

        if (statusCode === 401 || statusCode === 403) {
          debugLog(urlPath, 'auth error, status', statusCode);
          finish({ ok: false, error: 'Invalid or unauthorized API key', errorKind: 'auth' });
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          debugLog(urlPath, 'http error, status', statusCode);
          finish({ ok: false, error: `Request failed (HTTP ${statusCode})`, errorKind: 'http' });
          return;
        }

        try {
          const parsed = JSON.parse(body);
          finish({ ok: true, data: parsed && typeof parsed === 'object' ? parsed : {} });
        } catch (err) {
          debugLog(urlPath, 'parse error:', err.message);
          finish({ ok: false, error: 'Could not parse response from OpenRouter', errorKind: 'parse' });
        }
      });
    });

    req.on('error', (err) => {
      debugLog(urlPath, 'network error:', err.message);
      finish({ ok: false, error: 'Network error contacting OpenRouter', errorKind: 'network' });
    });

    req.on('timeout', () => {
      req.destroy();
      debugLog(urlPath, 'request timed out');
      finish({ ok: false, error: 'Request to OpenRouter timed out', errorKind: 'network' });
    });

    req.end();
  });
}

// Fetch usage/spend and credit balance for an OpenRouter API key.
// Always resolves; never throws. See module header for the contract.
async function fetchOpenRouter(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return { ok: false, error: 'Missing OpenRouter API key', errorKind: 'auth' };
  }

  const [keyResult, creditsResult] = await Promise.all([
    httpsGetJson('/api/v1/key', apiKey),
    httpsGetJson('/api/v1/credits', apiKey)
  ]);

  // Both failed — nothing usable to return.
  if (!keyResult.ok && !creditsResult.ok) {
    // Prefer an 'auth' classification if either call detected bad credentials,
    // since that's the most actionable signal for the UI.
    const authFailure = keyResult.errorKind === 'auth' ? keyResult : (creditsResult.errorKind === 'auth' ? creditsResult : null);
    const primary = authFailure || keyResult;
    return { ok: false, error: primary.error, errorKind: primary.errorKind };
  }

  const result = { ok: true };
  const warnings = [];

  if (keyResult.ok) {
    const data = keyResult.data && keyResult.data.data ? keyResult.data.data : {};
    result.spend = {
      today: num(data.usage_daily),
      week: num(data.usage_weekly),
      month: num(data.usage_monthly),
      total: num(data.usage)
    };
    result.limit = (data.limit === null || typeof data.limit === 'number') ? data.limit : null;
    result.limitRemaining = (data.limit_remaining === null || typeof data.limit_remaining === 'number') ? data.limit_remaining : null;
    if (typeof data.is_free_tier === 'boolean') {
      result.isFreeTier = data.is_free_tier;
    }
  } else {
    warnings.push(`Usage data unavailable: ${keyResult.error}`);
  }

  if (creditsResult.ok) {
    const data = creditsResult.data && creditsResult.data.data ? creditsResult.data.data : {};
    const total = num(data.total_credits);
    const used = num(data.total_usage);
    result.credits = {
      total,
      used,
      remaining: (total !== undefined && used !== undefined) ? round4(total - used) : undefined
    };
  } else {
    warnings.push(`Credit balance unavailable: ${creditsResult.error}`);
  }

  if (warnings.length > 0) {
    result.warning = warnings.join('; ');
  }

  return result;
}

module.exports = { fetchOpenRouter };

// Standalone smoke test: `node src/providers/openrouter.js`
// Reads OPENROUTER_API_KEY from the environment; never prints the key itself.
if (require.main === module) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('Set OPENROUTER_API_KEY in your environment to run this smoke test.');
    process.exitCode = 1;
  } else {
    fetchOpenRouter(apiKey).then((result) => {
      console.log(JSON.stringify(result, null, 2));
    });
  }
}
