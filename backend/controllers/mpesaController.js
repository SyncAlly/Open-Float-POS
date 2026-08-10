/**
 * OpenFloat POS X — M-Pesa Daraja API Controller
 * Handles: OAuth token, STK Push, Callback, Transaction Status Query
 * API: Safaricom Daraja 1.0 (STK Push / Lipa Na M-Pesa Online)
 */

const https = require('https');
const { exec, query, getDb } = require('../db/database');

// ─── Config ─────────────────────────────────────────────────────────────────

const DARAJA_BASE = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

const CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY    || '';
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || '';
const SHORTCODE       = process.env.MPESA_SHORTCODE       || '174379';        // Sandbox default
const PASSKEY         = process.env.MPESA_PASSKEY         || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919'; // Sandbox default
const CALLBACK_URL    = process.env.MPESA_CALLBACK_URL    || 'https://yourdomain.com/api/mpesa/callback';

// In-memory pending payments: checkoutRequestId -> {resolve, reject, data}
const _pendingPayments = new Map();

// Cached OAuth token
let _oauthToken = null;
let _tokenExpiry = 0;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daraja(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(DARAJA_BASE + path);
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };

    // Basic auth for token endpoint
    if (path.includes('/oauth/')) {
      const creds = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
      headers.Authorization = `Basic ${creds}`;
    }

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getAccessToken() {
  if (_oauthToken && Date.now() < _tokenExpiry) return _oauthToken;

  const result = await daraja('GET', '/oauth/v1/generate?grant_type=client_credentials', null, null);

  if (!result.access_token) {
    throw new Error(`M-Pesa OAuth failed: ${JSON.stringify(result)}`);
  }

  _oauthToken = result.access_token;
  _tokenExpiry = Date.now() + (parseInt(result.expires_in) || 3600) * 1000 - 60000;
  return _oauthToken;
}

function generatePassword() {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const raw = SHORTCODE + PASSKEY + timestamp;
  return {
    password: Buffer.from(raw).toString('base64'),
    timestamp
  };
}

function formatPhone(phone) {
  // Normalize phone to 2547XXXXXXXX format
  const clean = phone.replace(/\D/g, '');
  if (clean.startsWith('0'))  return '254' + clean.slice(1);
  if (clean.startsWith('7'))  return '254' + clean;
  if (clean.startsWith('+'))  return clean.slice(1);
  return clean;
}

// ─── Persist payment record in DB ──────────────────────────────────────────

async function saveMpesaPayment(db, data) {
  exec(db, `
    CREATE TABLE IF NOT EXISTS mpesa_payments (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      checkout_request_id TEXT UNIQUE,
      merchant_request_id TEXT,
      transaction_ref     TEXT,
      phone               TEXT,
      amount              REAL,
      status              TEXT DEFAULT 'pending',
      mpesa_receipt_no    TEXT,
      result_desc         TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  exec(db, `
    INSERT OR IGNORE INTO mpesa_payments
      (checkout_request_id, merchant_request_id, transaction_ref, phone, amount, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `, [data.checkoutRequestId, data.merchantRequestId, data.transactionRef, data.phone, data.amount]);
}

async function updateMpesaPayment(db, checkoutRequestId, status, receiptNo, resultDesc) {
  exec(db, `
    UPDATE mpesa_payments
    SET status = ?, mpesa_receipt_no = ?, result_desc = ?, updated_at = CURRENT_TIMESTAMP
    WHERE checkout_request_id = ?
  `, [status, receiptNo || null, resultDesc || null, checkoutRequestId]);
}

// ─── STK Push ──────────────────────────────────────────────────────────────

async function initiateStkPush(req, res) {
  try {
    // If credentials not configured, return sandbox simulation
    if (!CONSUMER_KEY || !CONSUMER_SECRET) {
      return res.json({
        success: true,
        sandbox: true,
        message: 'Sandbox mode: M-Pesa credentials not configured. Set MPESA_CONSUMER_KEY & MPESA_CONSUMER_SECRET in .env',
        CheckoutRequestID: 'ws_CO_SANDBOX_' + Date.now(),
        MerchantRequestID: 'SB-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
        CustomerMessage: 'Success. Request accepted for processing'
      });
    }

    const { phone, amount, transaction_ref, account_ref } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: 'Phone number and amount are required.' });
    }

    const token = await getAccessToken();
    const { password, timestamp } = generatePassword();
    const formattedPhone = formatPhone(phone);
    const formattedAmount = Math.ceil(parseFloat(amount)); // M-Pesa requires whole numbers

    const payload = {
      BusinessShortCode: SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   'CustomerPayBillOnline',
      Amount:            formattedAmount,
      PartyA:            formattedPhone,
      PartyB:            SHORTCODE,
      PhoneNumber:       formattedPhone,
      CallBackURL:       CALLBACK_URL,
      AccountReference:  account_ref || transaction_ref || 'OpenFloat',
      TransactionDesc:   `OpenFloat POS Payment - ${transaction_ref || 'Order'}`
    };

    const result = await daraja('POST', '/mpesa/stkpush/v1/processrequest', payload, token);

    if (result.ResponseCode !== '0') {
      return res.status(400).json({
        error: result.ResponseDescription || result.errorMessage || 'STK Push failed',
        details: result
      });
    }

    // Persist to DB
    const db = await getDb();
    await saveMpesaPayment(db, {
      checkoutRequestId:  result.CheckoutRequestID,
      merchantRequestId:  result.MerchantRequestID,
      transactionRef:     transaction_ref || null,
      phone:              formattedPhone,
      amount:             formattedAmount
    });

    res.json({
      success:           true,
      CheckoutRequestID: result.CheckoutRequestID,
      MerchantRequestID: result.MerchantRequestID,
      CustomerMessage:   result.CustomerMessage,
      phone:             formattedPhone,
      amount:            formattedAmount
    });

  } catch (err) {
    console.error('[M-Pesa STK Push Error]', err.message);
    res.status(500).json({ error: 'STK Push request failed: ' + err.message });
  }
}

// ─── Callback (Safaricom POSTs here after payment) ─────────────────────────

async function handleCallback(req, res) {
  // Always acknowledge Safaricom immediately
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  console.log('[M-Pesa Callback] Received at', new Date().toISOString());
  console.log('[M-Pesa Callback] Raw body:', JSON.stringify(req.body, null, 2));

  try {
    const body = req.body?.Body?.stkCallback;
    if (!body) {
      console.log('[M-Pesa Callback] WARNING: No stkCallback in body. Full body:', JSON.stringify(req.body));
      return;
    }

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = body;
    console.log(`[M-Pesa Callback] CheckoutRequestID: ${CheckoutRequestID}`);
    console.log(`[M-Pesa Callback] ResultCode: ${ResultCode} | ResultDesc: ${ResultDesc}`);

    const db = await getDb();

    if (ResultCode === 0) {
      // Payment successful — extract metadata
      const items = CallbackMetadata?.Item || [];
      const getMeta = (name) => items.find(i => i.Name === name)?.Value;

      const receiptNo = getMeta('MpesaReceiptNumber');
      const amount    = getMeta('Amount');
      const phone     = getMeta('PhoneNumber');

      await updateMpesaPayment(db, CheckoutRequestID, 'completed', receiptNo, ResultDesc);

      // Retrieve transaction ref to link sales record
      const rows = query(db, 'SELECT * FROM mpesa_payments WHERE checkout_request_id = ?', [CheckoutRequestID]);
      const payment = rows[0];

      console.log(`[M-Pesa] Payment CONFIRMED: ${receiptNo} | KES ${amount} | ${phone}`);

      // Notify pending poll requests if any
      if (_pendingPayments.has(CheckoutRequestID)) {
        const { resolve } = _pendingPayments.get(CheckoutRequestID);
        resolve({ status: 'completed', receiptNo, amount, phone, transactionRef: payment?.transaction_ref });
        _pendingPayments.delete(CheckoutRequestID);
      }

    } else {
      // Payment failed or cancelled
      await updateMpesaPayment(db, CheckoutRequestID, 'failed', null, ResultDesc);
      console.log(`[M-Pesa] Payment FAILED: ${CheckoutRequestID} — ${ResultDesc}`);

      if (_pendingPayments.has(CheckoutRequestID)) {
        const { reject } = _pendingPayments.get(CheckoutRequestID);
        reject(new Error(ResultDesc));
        _pendingPayments.delete(CheckoutRequestID);
      }
    }
  } catch (err) {
    console.error('[M-Pesa Callback Error]', err.message);
  }
}

// ─── Poll Payment Status ────────────────────────────────────────────────────

async function queryPaymentStatus(req, res) {
  try {
    const { checkout_request_id } = req.params;
    const db = await getDb();

    const rows = query(db, 'SELECT * FROM mpesa_payments WHERE checkout_request_id = ?', [checkout_request_id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Payment record not found.' });
    }

    const payment = rows[0];
    res.json({
      success:           true,
      status:            payment.status,
      mpesa_receipt_no:  payment.mpesa_receipt_no,
      amount:            payment.amount,
      phone:             payment.phone,
      transaction_ref:   payment.transaction_ref,
      result_desc:       payment.result_desc,
      created_at:        payment.created_at,
      updated_at:        payment.updated_at
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── STK Query (Safaricom's own status check API) ───────────────────────────

async function querySTKStatus(req, res) {
  try {
    if (!CONSUMER_KEY || !CONSUMER_SECRET) {
      return res.json({ success: true, sandbox: true, ResultCode: '0', ResultDesc: 'Sandbox simulation - payment confirmed' });
    }

    const { checkout_request_id } = req.params;
    const token = await getAccessToken();
    const { password, timestamp } = generatePassword();

    const payload = {
      BusinessShortCode: SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      CheckoutRequestID: checkout_request_id
    };

    const result = await daraja('POST', '/mpesa/stkpushquery/v1/query', payload, token);
    
    // If Safaricom confirms successful payment, update DB automatically
    if (result.ResultCode === '0' || result.ResultCode === 0) {
      const db = await getDb();
      await updateMpesaPayment(db, checkout_request_id, 'completed', result.MpesaReceiptNumber || null, result.ResultDesc);
    } else if (result.ResultCode && result.ResultCode !== '0') {
      const db = await getDb();
      await updateMpesaPayment(db, checkout_request_id, 'failed', null, result.ResultDesc);
    }

    res.json({ success: true, ...result });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Recent M-Pesa Payments List ────────────────────────────────────────────

async function listMpesaPayments(req, res) {
  try {
    const db = await getDb();
    const { limit = 50, status } = req.query;
    let sql = 'SELECT * FROM mpesa_payments';
    const params = [];
    if (status) { sql += ' WHERE status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));
    const rows = query(db, sql, params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  initiateStkPush,
  handleCallback,
  queryPaymentStatus,
  querySTKStatus,
  listMpesaPayments
};
