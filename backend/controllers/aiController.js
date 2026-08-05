/**
 * OpenFloat POS X — AI Business Assistant Controller
 * Uses Google Gemini API with live database context for intelligent business insights.
 * Set GEMINI_API_KEY in your .env file to activate.
 */

const { getDb } = require('../db/database');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─── Gemini client (initialised lazily so missing key gives a clean error) ───
let _genAI = null;
function getGenAI() {
  if (!_genAI) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key === 'YOUR_GEMINI_API_KEY_HERE') {
      throw new Error('GEMINI_API_KEY is not configured in .env');
    }
    _genAI = new GoogleGenerativeAI(key);
  }
  return _genAI;
}

// ─── Fetch a live business context snapshot from the SQLite database ─────────
async function buildBusinessContext() {
  const db = await getDb();

  const q = (sql) => {
    try {
      const stmt = db.prepare(sql);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    } catch {
      return [];
    }
  };
  const q1 = (sql) => {
    const rows = q(sql);
    return rows.length ? rows[0] : {};
  };

  // Sales summary (last 30 days)
  const salesSummary = q1(`
    SELECT
      COUNT(*)                                         AS total_transactions,
      ROUND(SUM(total_amount), 2)                      AS total_revenue,
      ROUND(SUM(CASE WHEN payment_method='cash'  THEN total_amount ELSE 0 END), 2) AS cash_revenue,
      ROUND(SUM(CASE WHEN payment_method='mpesa' THEN total_amount ELSE 0 END), 2) AS mpesa_revenue,
      ROUND(SUM(CASE WHEN payment_method='card'  THEN total_amount ELSE 0 END), 2) AS card_revenue,
      ROUND(SUM(discount_amount), 2)                   AS total_discounts,
      ROUND(SUM(tax_amount), 2)                        AS total_vat
    FROM transactions
    WHERE status = 'completed'
      AND created_at >= datetime('now', '-30 days')
  `);

  // Top 5 selling products (last 30 days)
  const topProducts = q(`
    SELECT p.name, SUM(si.quantity) AS qty_sold, ROUND(SUM(si.subtotal), 2) AS revenue
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    JOIN transactions t ON t.id = si.transaction_id
    WHERE t.status = 'completed' AND t.created_at >= datetime('now', '-30 days')
    GROUP BY si.product_id
    ORDER BY qty_sold DESC
    LIMIT 5
  `);

  // Low stock alerts
  const lowStock = q(`
    SELECT name, sku, stock_qty, reorder_level
    FROM products
    WHERE is_active = 1 AND stock_qty <= reorder_level
    ORDER BY stock_qty ASC
    LIMIT 10
  `);

  // Customer stats
  const customerStats = q1(`
    SELECT
      COUNT(*) AS total_customers,
      SUM(CASE WHEN credit_balance > 0 THEN 1 ELSE 0 END) AS customers_with_debt,
      ROUND(SUM(credit_balance), 2) AS total_ar_balance,
      SUM(loyalty_points) AS total_loyalty_points
    FROM customers
    WHERE is_active = 1
  `);

  // Inventory overview
  const inventoryStats = q1(`
    SELECT
      COUNT(*) AS total_products,
      SUM(stock_qty) AS total_stock_units,
      ROUND(SUM(stock_qty * buy_price), 2) AS inventory_value,
      SUM(CASE WHEN stock_qty = 0 THEN 1 ELSE 0 END) AS out_of_stock
    FROM products
    WHERE is_active = 1
  `);

  // Supplier count
  const supplierStats = q1(`
    SELECT COUNT(*) AS total_suppliers, ROUND(AVG(rating), 1) AS avg_rating
    FROM suppliers WHERE is_active = 1
  `);

  // HR payroll estimate
  const hrStats = q1(`
    SELECT COUNT(*) AS active_staff, ROUND(SUM(salary), 2) AS monthly_payroll
    FROM employees WHERE status = 'active'
  `);

  // Pending purchase requests
  const procurementStats = q1(`
    SELECT
      COUNT(*) AS total_prs,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending_prs,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved_prs
    FROM purchase_requests
  `);

  // Outstanding deliveries
  const logisticsStats = q1(`
    SELECT
      COUNT(*) AS total_deliveries,
      SUM(CASE WHEN status='in_transit' THEN 1 ELSE 0 END) AS in_transit,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending_dispatch
    FROM deliveries
  `);

  return {
    date: new Date().toISOString().split('T')[0],
    business: 'OpenFloat Enterprise Ltd',
    currency: 'KES',
    sales_last_30_days: salesSummary,
    top_selling_products: topProducts,
    low_stock_alerts: lowStock,
    customer_overview: customerStats,
    inventory_overview: inventoryStats,
    supplier_overview: supplierStats,
    hr_overview: hrStats,
    procurement_overview: procurementStats,
    logistics_overview: logisticsStats
  };
}

// ─── Chat history stored per session (simple in-memory, per-request for now) ──
// For production, use Redis or a DB-backed session store.
const _chatSessions = new Map();

/**
 * POST /api/ai/chat
 * Body: { message: string, sessionId?: string, history?: Array }
 */
async function chat(req, res) {
  try {
    const genAI = getGenAI();
    const { message, sessionId = 'default', history = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Build live business context
    let context;
    try {
      context = await buildBusinessContext();
    } catch (dbErr) {
      context = { note: 'Live DB context unavailable', date: new Date().toISOString() };
    }

    const contextJson = JSON.stringify(context, null, 2);

    // System prompt — business-expert persona with injected live data
    const systemPrompt = `You are an expert AI business analyst and advisor for OpenFloat POS X, a Point-of-Sale and business management system used by retail and wholesale businesses in Kenya.

You have access to the following LIVE business data snapshot as of ${context.date}:

\`\`\`json
${contextJson}
\`\`\`

Your role is to:
1. Provide specific, data-driven insights using the actual numbers above (e.g. reference real stock levels, sales figures, customer counts).
2. Give actionable, practical recommendations tailored to Kenyan retail/wholesale businesses.
3. Be concise but thorough — business owners are busy. Use bullet points when listing multiple items.
4. If asked about something not in the data, acknowledge the limitation and give general best-practice advice.
5. Use KES (Kenyan Shillings) for all monetary figures.
6. Do NOT make up data that is not in the context. If a metric is 0 or null, say so honestly.
7. You can reference M-Pesa, Kenya Revenue Authority (KRA), VAT, and local business context naturally.

Always respond in a professional, friendly, and helpful tone.`;

    const model = genAI.getGenerativeModel({
      model: 'gemini-flash-latest',
      systemInstruction: systemPrompt
    });

    // Build chat history for multi-turn conversation
    const chatHistory = history.map(msg => ({
      role: msg.role === 'bot' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));

    const chatSession = model.startChat({ history: chatHistory });
    const result = await chatSession.sendMessage(message.trim());
    const responseText = result.response.text();

    res.json({
      reply: responseText,
      context_snapshot: {
        revenue_30d: context.sales_last_30_days?.total_revenue || 0,
        low_stock_count: context.low_stock_alerts?.length || 0,
        total_customers: context.customer_overview?.total_customers || 0
      }
    });

  } catch (err) {
    console.error('[AI Chat Error]', err.message);

    // Provide a clear message if the API key is missing
    if (err.message.includes('GEMINI_API_KEY')) {
      return res.status(503).json({
        error: 'AI assistant is not configured. Please add GEMINI_API_KEY to your .env file.',
        code: 'NO_API_KEY'
      });
    }

    // Quota / rate limit exceeded
    if (err.message.includes('429') || err.message.includes('quota') || err.message.includes('Too Many Requests')) {
      return res.status(429).json({
        error: 'Gemini API quota exceeded. Your free-tier key has hit its daily limit. Please enable billing at https://ai.dev or wait until tomorrow.',
        code: 'QUOTA_EXCEEDED'
      });
    }

    res.status(500).json({
      error: 'AI service temporarily unavailable. Please try again.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
}

/**
 * GET /api/ai/insights
 * Returns proactive AI-generated business insights for the sidebar panel.
 */
async function getInsights(req, res) {
  try {
    const genAI = getGenAI();

    let context;
    try {
      context = await buildBusinessContext();
    } catch {
      return res.json({ insights: [] });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    const prompt = `Based on this business data: ${JSON.stringify(context)}

Generate exactly 5 short, specific business insights as a JSON array. Each insight must have:
- "type": one of "success", "warning", "danger", "info", "purple"  
- "title": a bold 4-8 word headline
- "body": 1-2 sentence insight referencing actual numbers from the data

Return ONLY valid JSON array, no markdown, no explanation. Example format:
[{"type":"success","title":"Revenue up this month","body":"Sales reached KES X, up Y% vs last month."}]`;

    const result = await model.generateContent(prompt);
    let text = result.response.text().trim();

    // Strip markdown code fences if present
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    let insights = [];
    try {
      insights = JSON.parse(text);
    } catch {
      insights = [];
    }

    res.json({ insights });

  } catch (err) {
    console.error('[AI Insights Error]', err.message);
    res.json({ insights: [] }); // Graceful fallback — don't break the page
  }
}

module.exports = { chat, getInsights };
