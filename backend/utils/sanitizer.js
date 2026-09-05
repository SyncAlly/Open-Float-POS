/**
 * OpenFloat POS X — Input Sanitizer Utility
 * 
 * Provides robust HTML/script tag stripping, string trimming,
 * and length bounding for defense-in-depth security against XSS.
 */

// Keys whose values should not be HTML-scrubbed (e.g. passwords, secrets)
// to prevent corrupting complex passwords containing '<' or '>'
const UNTOUCHED_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /passkey/i,
  /token/i,
  /hash/i
];

/**
 * Iteratively removes HTML and script tags until no tags remain.
 * This prevents nested bypass attempts such as <scr<script>ipt>.
 * Preserves safe text including mathematical comparisons like "1 < 2".
 * 
 * @param {string} str 
 * @returns {string}
 */
function scrubHtml(str) {
  if (typeof str !== 'string') return str;

  let prev = '';
  let curr = str;
  let iterations = 0;

  while (prev !== curr && iterations < 10) {
    prev = curr;
    curr = curr
      // 1. Remove script tags and their contents
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*$/gi, '')
      // 2. Remove style tags and their contents
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*$/gi, '')
      // 3. Remove embedded objects, applets, iframes and their contents
      .replace(/<(iframe|object|embed|applet)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      // 4. Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, '')
      // 5. Remove any other HTML/XML opening, closing, or self-closing tags
      .replace(/<(?:\/|!)?[a-zA-Z][^>]*>/g, '');
    iterations++;
  }

  return curr;
}

/**
 * Sanitizes a single value: trims whitespace, scrubs HTML, and bounds length.
 * Recursively processes arrays and plain objects.
 * 
 * @param {*} val 
 * @param {number} [maxLen=10000] - Default upper safety ceiling
 * @param {string} [keyName=''] - The property key name to detect passwords/secrets
 * @returns {*}
 */
function sanitizeValue(val, maxLen = 10000, keyName = '') {
  if (val === null || val === undefined) {
    return val;
  }

  if (typeof val === 'string') {
    let result = val.trim();
    // Do not scrub HTML tags from passwords or secrets
    const isUntouchedKey = UNTOUCHED_KEY_PATTERNS.some(pattern => pattern.test(keyName));
    if (!isUntouchedKey) {
      result = scrubHtml(result).trim();
    }
    if (typeof maxLen === 'number' && maxLen > 0 && result.length > maxLen) {
      result = result.slice(0, maxLen);
    }
    return result;
  }

  if (Array.isArray(val)) {
    return val.map(item => sanitizeValue(item, maxLen, keyName));
  }

  if (typeof val === 'object' && val.constructor === Object) {
    const sanitizedObj = {};
    for (const [k, v] of Object.entries(val)) {
      const cleanKey = scrubHtml(k).trim().slice(0, 100);
      sanitizedObj[cleanKey] = sanitizeValue(v, maxLen, cleanKey);
    }
    return sanitizedObj;
  }

  return val;
}

/**
 * Global Express middleware that recursively sanitizes req.body, req.query, and req.params.
 */
function sanitizeRequest(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeValue(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeValue(req.params);
  }
  next();
}

module.exports = {
  scrubHtml,
  sanitizeValue,
  sanitizeRequest,
  UNTOUCHED_KEY_PATTERNS
};
