// Codex (OpenAI ChatGPT subscription) usage provider.
//
// Reads OAuth tokens written by the Codex CLI (`codex login`) from
// ~/.codex/auth.json and calls the UNOFFICIAL/reverse-engineered
// chatgpt.com/backend-api/wham/usage endpoint to retrieve rate-limit
// utilization. This endpoint is not publicly documented by OpenAI and its
// response shape has been observed to vary across accounts/rollouts, so
// parsing here is intentionally defensive — see parseUsageResponse().
//
// Output mirrors the Claude provider's data shape so the renderer can reuse
// its existing row-rendering logic:
//   { ok: true, five_hour: { utilization, resets_at }, seven_day: { utilization, resets_at }, raw_plan? }
//   { ok: false, errorKind, error }
'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Debug mode: set DEBUG_LOG=1 env var or pass --debug flag to see verbose logs.
// Mirrors main.js's gating so provider logs stay silent for regular users.
const DEBUG = process.env.DEBUG_LOG === '1' || process.argv.includes('--debug');
function debugLog(...args) {
  if (DEBUG) console.log('[Debug][codex]', ...args);
}

const CODEX_AUTH_PATH = path.join(os.homedir(), '.codex', 'auth.json');
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const REQUEST_TIMEOUT_MS = 10000;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Sync check for whether Codex CLI credentials are present on disk.
 * @returns {{present: boolean, path: string}}
 */
function getCodexAuthStatus() {
  let present = false;
  try {
    present = fs.existsSync(CODEX_AUTH_PATH);
  } catch (err) {
    debugLog('existsSync failed:', err.message);
    present = false;
  }
  return { present, path: CODEX_AUTH_PATH };
}

/**
 * Read and validate ~/.codex/auth.json.
 * @returns {{ok: true, accessToken: string, accountId: string} | {ok: false, errorKind: string, error: string}}
 */
function readCodexAuth() {
  let raw;
  try {
    raw = fs.readFileSync(CODEX_AUTH_PATH, 'utf-8');
  } catch (err) {
    debugLog('Failed to read auth.json:', err.message);
    return { ok: false, errorKind: 'no-auth', error: 'Codex CLI login not found — run codex login' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    debugLog('Failed to parse auth.json:', err.message);
    return { ok: false, errorKind: 'no-auth', error: 'Codex CLI login not found — run codex login' };
  }

  const accessToken = parsed?.tokens?.access_token;
  const accountId = parsed?.tokens?.account_id;

  if (!accessToken || !accountId) {
    return { ok: false, errorKind: 'no-auth', error: 'Codex CLI login not found — run codex login' };
  }

  return { ok: true, accessToken, accountId };
}

/**
 * Perform the HTTPS GET against the Codex usage endpoint.
 * Resolves with { statusCode, body } and never rejects — network failures are
 * mapped to a synthetic result so the caller has a single control-flow path.
 */
function requestUsage(accessToken, accountId) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let urlObj;
    try {
      urlObj = new URL(USAGE_URL);
    } catch (err) {
      settle({ networkError: err });
      return;
    }

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'ChatGPT-Account-Id': accountId,
        'Accept': 'application/json',
        'User-Agent': BROWSER_USER_AGENT
      },
      timeout: REQUEST_TIMEOUT_MS
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        settle({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });

    req.on('error', (err) => {
      settle({ networkError: err });
    });

    req.on('timeout', () => {
      req.destroy();
      settle({ networkError: new Error('Request timed out') });
    });

    req.end();
  });
}

/**
 * Convert a percent-used-style field on a window into utilization (0-100).
 * Returns null if no recognizable percent field is present.
 */
function extractPercent(win) {
  if (!win || typeof win !== 'object') return null;

  const usedCandidates = [win.used_percent, win.usage_percent, win.percent_used];
  for (const candidate of usedCandidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  const leftCandidates = [win.percent_left, win.remaining_percent];
  for (const candidate of leftCandidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return 100 - candidate;
    }
  }

  return null;
}

/**
 * Determine resets_at (ISO string or null) for a window using the documented
 * variants, in priority order.
 */
function extractResetsAt(win) {
  if (!win || typeof win !== 'object') return null;

  if (typeof win.resets_in_seconds === 'number' && Number.isFinite(win.resets_in_seconds)) {
    return new Date(Date.now() + win.resets_in_seconds * 1000).toISOString();
  }

  const directCandidates = [win.reset_at, win.resets_at, win.reset_time];
  for (const candidate of directCandidates) {
    if (candidate === undefined || candidate === null) continue;

    if (typeof candidate === 'string') {
      const parsed = new Date(candidate);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
      continue;
    }

    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      // Detect seconds vs milliseconds by magnitude. Epoch ms for "now" is
      // ~1.7e12; epoch seconds for "now" is ~1.7e9. 1e12 is a safe boundary.
      const ms = candidate < 1e12 ? candidate * 1000 : candidate;
      const parsed = new Date(ms);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }

  // Fallback: compute from a window length + explicit start, if present.
  const windowSeconds = typeof win.window_minutes === 'number'
    ? win.window_minutes * 60
    : (typeof win.limit_window_seconds === 'number' ? win.limit_window_seconds : null);
  const windowStart = win.window_start ?? win.started_at ?? win.start_time;

  if (windowSeconds !== null && windowStart !== undefined && windowStart !== null) {
    let startMs = null;
    if (typeof windowStart === 'string') {
      const parsedStart = new Date(windowStart);
      if (!Number.isNaN(parsedStart.getTime())) startMs = parsedStart.getTime();
    } else if (typeof windowStart === 'number' && Number.isFinite(windowStart)) {
      startMs = windowStart < 1e12 ? windowStart * 1000 : windowStart;
    }
    if (startMs !== null) {
      return new Date(startMs + windowSeconds * 1000).toISOString();
    }
  }

  return null;
}

function roundUtilization(percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  return Math.round(clamped * 10) / 10;
}

/**
 * Defensively parse the (unofficial, undocumented) usage response body into
 * our normalized shape. Returns null if nothing recognizable was found.
 */
function parseUsageResponse(data) {
  if (!data || typeof data !== 'object') return null;

  const container = data.rate_limit || data.rate_limits || data;
  if (!container || typeof container !== 'object') return null;

  const primaryWindow = container.primary_window || container.primary;
  const secondaryWindow = container.secondary_window || container.secondary;

  const primaryPercent = extractPercent(primaryWindow);
  const secondaryPercent = extractPercent(secondaryWindow);

  if (primaryPercent === null && secondaryPercent === null) {
    return null;
  }

  const five_hour = primaryPercent === null ? null : {
    utilization: roundUtilization(primaryPercent),
    resets_at: extractResetsAt(primaryWindow)
  };

  const seven_day = secondaryPercent === null ? null : {
    utilization: roundUtilization(secondaryPercent),
    resets_at: extractResetsAt(secondaryWindow)
  };

  const result = { ok: true, five_hour, seven_day };

  const plan = data.plan || data.plan_type || container.plan || container.plan_type;
  if (typeof plan === 'string' && plan.trim()) {
    result.raw_plan = plan;
  }

  return result;
}

/**
 * Fetch Codex (ChatGPT subscription) rate-limit usage. Never throws — all
 * failure modes are surfaced via the { ok: false, errorKind, error } shape.
 * @returns {Promise<object>}
 */
async function fetchCodex() {
  const auth = readCodexAuth();
  if (!auth.ok) {
    return auth;
  }

  let response;
  try {
    response = await requestUsage(auth.accessToken, auth.accountId);
  } catch (err) {
    // requestUsage() is designed to never reject, but guard anyway.
    debugLog('Unexpected request failure:', err.message);
    return { ok: false, errorKind: 'network', error: 'Could not reach Codex usage endpoint' };
  }

  if (response.networkError) {
    debugLog('Network error:', response.networkError.message);
    return { ok: false, errorKind: 'network', error: 'Could not reach Codex usage endpoint' };
  }

  const { statusCode, body } = response;

  if (statusCode === 401 || statusCode === 403) {
    debugLog('Auth rejected, status:', statusCode);
    return { ok: false, errorKind: 'expired', error: 'Codex login expired — run codex login again' };
  }

  if (statusCode === 404 || statusCode >= 500) {
    debugLog('Endpoint error, status:', statusCode);
    return { ok: false, errorKind: 'endpoint', error: 'Codex usage endpoint is unavailable' };
  }

  if (statusCode < 200 || statusCode >= 300) {
    debugLog('Unexpected status:', statusCode);
    return { ok: false, errorKind: 'endpoint', error: 'Codex usage endpoint returned an unexpected response' };
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch (err) {
    // Likely a Cloudflare challenge page or other non-JSON HTML response.
    debugLog('Non-JSON response (first 200 chars):', body.slice(0, 200));
    return { ok: false, errorKind: 'endpoint', error: 'Codex usage endpoint returned an unexpected response' };
  }

  const parsed = parseUsageResponse(data);
  if (!parsed) {
    debugLog('Unrecognized response shape, top-level keys:', Object.keys(data || {}));
    return { ok: false, errorKind: 'parse', error: 'Unrecognized usage response format' };
  }

  return parsed;
}

module.exports = { fetchCodex, getCodexAuthStatus };

if (require.main === module) {
  (async () => {
    const result = await fetchCodex();
    console.log(JSON.stringify(result, null, 2));
  })();
}
