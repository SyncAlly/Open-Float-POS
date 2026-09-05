/**
 * OpenFloat POS X — Schema Validation and XSS Sanitization Tests
 */

const assert = require('assert');
const Joi = require('joi');
const { scrubHtml, sanitizeValue, sanitizeRequest } = require('../utils/sanitizer');
const { validate, schemas } = require('../middleware/validation');

console.log('🧪 Starting Schema Validation & Sanitization Tests...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✕ ${name}`);
    console.error(`    Error: ${err.message}`);
    failed++;
  }
}

// ── 1. HTML & Script Tag Scrubbing Tests ──
console.log('[1] Testing HTML & Script Tag Scrubbing (scrubHtml)');

test('Strips simple <script> tags and contents', () => {
  const input = 'Hello <script>alert("xss")</script> World';
  const expected = 'Hello  World';
  assert.strictEqual(scrubHtml(input).trim(), expected);
});

test('Strips uppercase <SCRIPT> tags with attributes', () => {
  const input = 'Test <SCRIPT SRC="http://evil.com/xss.js"></SCRIPT> Passed';
  const expected = 'Test  Passed';
  assert.strictEqual(scrubHtml(input).trim(), expected);
});

test('Strips nested script tags (<scr<script>ipt>)', () => {
  const input = 'Safe <scr<script>ipt>alert(1)</script> text';
  assert.strictEqual(scrubHtml(input).includes('script'), false);
  assert.strictEqual(scrubHtml(input).includes('alert'), false);
});

test('Strips inline HTML tags (<b onmouseover=evil()>)', () => {
  const input = 'Bold <b onmouseover="alert(1)">Text</b> Here';
  const expected = 'Bold Text Here';
  assert.strictEqual(scrubHtml(input).trim(), expected);
});

test('Strips iframes, objects, embeds, applets', () => {
  const input = 'Pre <iframe src="javascript:alert(1)"></iframe> <embed src="evil.swf"> Post';
  const expected = 'Pre   Post';
  assert.strictEqual(scrubHtml(input).trim(), expected);
});

test('Preserves safe text with math comparisons (1 < 2)', () => {
  const input = 'Item count 1 < 2 is valid';
  assert.strictEqual(scrubHtml(input).trim(), 'Item count 1 < 2 is valid');
});

// ── 2. Value Sanitizer Tests ──
console.log('\n[2] Testing Object Sanitizer (sanitizeValue)');

test('Recursively scrubs objects and arrays', () => {
  const payload = {
    title: '  <script>xss</script> Product Name  ',
    tags: ['<b>Electronics</b>', '  Sale  '],
    nested: {
      description: ' <iframe src="bad"></iframe> Description '
    }
  };

  const clean = sanitizeValue(payload);
  assert.strictEqual(clean.title, 'Product Name');
  assert.deepStrictEqual(clean.tags, ['Electronics', 'Sale']);
  assert.strictEqual(clean.nested.description, 'Description');
});

test('Does not scrub HTML from passwords or secret keys', () => {
  const payload = {
    username: '  john_doe <script>  ',
    password: ' Password<123>! ',
    mpesa_secret: ' Secret<456>& '
  };

  const clean = sanitizeValue(payload);
  assert.strictEqual(clean.username, 'john_doe');
  assert.strictEqual(clean.password, 'Password<123>!'); // Preserved <123>
  assert.strictEqual(clean.mpesa_secret, 'Secret<456>&'); // Preserved <456>
});

// ── 3. Joi Middleware Validation Tests ──
console.log('\n[3] Testing Joi Middleware Schemas');

test('Validates and cleans login schema payload', () => {
  const req = {
    body: {
      username: '  admin123  ',
      password: ' Password<123>! '
    }
  };
  const res = {
    status: (code) => ({
      json: (data) => {
        throw new Error(`Unexpected error response ${code}: ${JSON.stringify(data)}`);
      }
    })
  };

  validate(schemas.login)(req, res, () => {
    assert.strictEqual(req.body.username, 'admin123');
    assert.strictEqual(req.body.password, 'Password<123>!');
  });
});

test('Rejects invalid email in customer creation schema', () => {
  const req = {
    body: {
      name: 'Acme Corp',
      email: 'not-an-email'
    }
  };
  let statusCode = 0;
  let jsonResponse = null;

  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonResponse = data; }
      };
    }
  };

  validate(schemas.createCustomer)(req, res, () => {});
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResponse.error, 'Validation error');
});

test('Strips unknown extra fields from validated body', () => {
  const req = {
    body: {
      username: 'cashier1',
      password: 'Password123!',
      malicious_field: 'hacked'
    }
  };
  const res = {};

  validate(schemas.login)(req, res, () => {
    assert.strictEqual(req.body.malicious_field, undefined);
    assert.strictEqual(req.body.username, 'cashier1');
  });
});

// ── Summary ──
console.log(`\n========================================`);
console.log(`Test Results: ${passed} passed, ${failed} failed.`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}
