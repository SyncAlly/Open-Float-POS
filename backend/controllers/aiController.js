const { getDb, query } = require('../db/database');
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

// ─── Format clean response: strip raw hashes, asterisks, tables ───
function formatCleanAIResponse(rawText) {
  if (!rawText) return '';
  let text = rawText;

  const lines = text.split('\n');
  const cleanedLines = [];
  let inTable = false;
  let tableHeader = null;

  for (let line of lines) {
    let trimmed = line.trim();

    // Strip markdown table separator lines |---|---|
    if (/^\|?[\s-:]+\|[\s-:|]+$/.test(trimmed)) {
      continue;
    }

    // Convert table row | 1 | Product | ... | to a clean list item
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.slice(1, -1).split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length > 0) {
        if (!tableHeader) {
          tableHeader = cells;
          continue; // Skip header row
        }
        cleanedLines.push(`${cells[0]}. **${cells[1] || ''}** — ${cells.slice(2).join(' · ')}`);
        continue;
      }
    } else {
      tableHeader = null;
    }

    // Strip markdown heading hashes (# Title -> **Title**)
    line = line.replace(/^#{1,6}\s*(.+)$/gm, '**$1**');

    // Strip horizontal rules (--- or ***)
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      cleanedLines.push('');
      continue;
    }

    // Convert bullet asterisks (* Item) to clean bullets or numbers
    line = line.replace(/^\s*\*\s+/gm, '• ');

    cleanedLines.push(line);
  }

  text = cleanedLines.join('\n');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

// ─── Fetch a live business context snapshot scoped by role & branch ─────────
async function buildBusinessContext(user, requestedBranchId) {
  const db = await getDb();
  const role = (user?.role || 'cashier').toLowerCase();
  const isOwner = role === 'owner';

  // Branch Managers are strictly locked to their assigned branch
  let activeBranchId = null;
  if (!isOwner) {
    activeBranchId = user?.branch_id || 1;
  } else {
    // Owner can view a specific branch or 'all' (Consolidated HQ)
    if (requestedBranchId && requestedBranchId !== 'all' && !isNaN(parseInt(requestedBranchId))) {
      activeBranchId = parseInt(requestedBranchId);
    }
  }

  let branchInfo = null;
  if (activeBranchId) {
    const bRows = query(db, 'SELECT id, name, location FROM branches WHERE id = ?', [activeBranchId]);
    branchInfo = bRows.length ? bRows[0] : { id: activeBranchId, name: `Branch #${activeBranchId}`, location: 'Local Store' };
  }

  const branchFilter = activeBranchId ? `AND branch_id = ${activeBranchId}` : '';
  const branchFilterT = activeBranchId ? `AND t.branch_id = ${activeBranchId}` : '';

  // 1. Sales summary (last 30 days)
  const salesSummaryRows = query(db, `
    SELECT
      COUNT(*)                                                                   AS total_transactions,
      ROUND(COALESCE(SUM(total), 0), 2)                                          AS total_revenue,
      ROUND(COALESCE(SUM(CASE WHEN payment_method='cash'  THEN total ELSE 0 END), 0), 2) AS cash_revenue,
      ROUND(COALESCE(SUM(CASE WHEN payment_method='mpesa' THEN total ELSE 0 END), 0), 2) AS mpesa_revenue,
      ROUND(COALESCE(SUM(CASE WHEN payment_method='card'  THEN total ELSE 0 END), 0), 2) AS card_revenue,
      ROUND(COALESCE(SUM(CASE WHEN payment_method='credit' THEN total ELSE 0 END), 0), 2) AS credit_revenue,
      ROUND(COALESCE(SUM(discount), 0), 2)                                       AS total_discounts,
      ROUND(COALESCE(SUM(vat), 0), 2)                                            AS total_vat
    FROM transactions
    WHERE status = 'completed'
      AND created_at >= datetime('now', '-30 days')
      ${branchFilter}
  `);
  const salesSummary = salesSummaryRows.length ? salesSummaryRows[0] : {};

  // 2. Top 5 selling products (last 30 days)
  const topProducts = query(db, `
    SELECT p.name, p.sku, SUM(ti.qty) AS qty_sold, ROUND(SUM(ti.line_total), 2) AS revenue
    FROM transaction_items ti
    JOIN products p ON p.id = ti.product_id
    JOIN transactions t ON t.id = ti.transaction_id
    WHERE t.status = 'completed'
      AND t.created_at >= datetime('now', '-30 days')
      ${branchFilterT}
    GROUP BY ti.product_id
    ORDER BY qty_sold DESC
    LIMIT 5
  `);

  // 3. Low stock alerts
  const lowStock = query(db, `
    SELECT name, sku, stock_qty, reorder_level
    FROM products
    WHERE is_active = 1
      AND stock_qty <= reorder_level
      ${branchFilter}
    ORDER BY stock_qty ASC
    LIMIT 10
  `);

  // 4. Customer overview
  const customerStatsRows = query(db, `
    SELECT
      COUNT(*) AS total_customers,
      SUM(CASE WHEN credit_balance > 0 THEN 1 ELSE 0 END) AS customers_with_debt,
      ROUND(COALESCE(SUM(credit_balance), 0), 2) AS total_ar_balance,
      COALESCE(SUM(loyalty_points), 0) AS total_loyalty_points
    FROM customers
    WHERE 1=1
      ${branchFilter}
  `);
  const customerStats = customerStatsRows.length ? customerStatsRows[0] : {};

  // 5. Inventory overview
  const inventoryStatsRows = query(db, `
    SELECT
      COUNT(*) AS total_products,
      COALESCE(SUM(stock_qty), 0) AS total_stock_units,
      ROUND(COALESCE(SUM(stock_qty * buy_price), 0), 2) AS inventory_value,
      SUM(CASE WHEN stock_qty = 0 THEN 1 ELSE 0 END) AS out_of_stock
    FROM products
    WHERE is_active = 1
      ${branchFilter}
  `);
  const inventoryStats = inventoryStatsRows.length ? inventoryStatsRows[0] : {};

  // 6. HR stats
  const hrStatsRows = query(db, `
    SELECT
      COUNT(*) AS active_staff,
      ROUND(COALESCE(SUM(salary), 0), 2) AS monthly_payroll,
      COALESCE(ROUND(AVG(attendance_pct), 1), 100) AS avg_attendance_rate
    FROM employees
    WHERE status != 'terminated'
      ${branchFilter}
  `);
  const hrStats = hrStatsRows.length ? hrStatsRows[0] : {};

  // 7. Procurement stats
  const procurementStatsRows = query(db, `
    SELECT
      COUNT(*) AS total_prs,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending_prs,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved_prs,
      ROUND(COALESCE(SUM(total_value), 0), 2) AS total_procurement_value
    FROM purchase_requests
    WHERE 1=1 ${branchFilter}
  `);
  const procurementStats = procurementStatsRows.length ? procurementStatsRows[0] : {};

  // 8. Logistics overview
  const logisticsStatsRows = query(db, `
    SELECT
      COUNT(*) AS total_deliveries,
      SUM(CASE WHEN status='in_transit' THEN 1 ELSE 0 END) AS in_transit,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending_dispatch,
      SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS delivered
    FROM deliveries
  `);
  const logisticsStats = logisticsStatsRows.length ? logisticsStatsRows[0] : {};

  // 9. Enterprise multi-branch breakdown (Exclusively available for Owner)
  let enterpriseBranchesBreakdown = null;
  if (isOwner) {
    enterpriseBranchesBreakdown = query(db, `
      SELECT
        b.id AS branch_id,
        b.name AS branch_name,
        b.location,
        (SELECT COUNT(*) FROM products p WHERE p.branch_id = b.id AND p.is_active = 1) AS total_products,
        (SELECT COALESCE(SUM(stock_qty), 0) FROM products p WHERE p.branch_id = b.id AND p.is_active = 1) AS total_stock_qty,
        (SELECT ROUND(COALESCE(SUM(total), 0), 2) FROM transactions t WHERE t.branch_id = b.id AND t.status = 'completed' AND t.created_at >= datetime('now', '-30 days')) AS revenue_30d,
        (SELECT COUNT(*) FROM transactions t WHERE t.branch_id = b.id AND t.status = 'completed' AND t.created_at >= datetime('now', '-30 days')) AS sales_count_30d,
        (SELECT COUNT(*) FROM employees e WHERE e.branch_id = b.id AND e.status != 'terminated') AS staff_count
      FROM branches b
      WHERE b.is_active = 1
      ORDER BY revenue_30d DESC
    `);
  }

  return {
    date: new Date().toISOString().split('T')[0],
    business: 'OpenFloat Enterprise Ltd',
    currency: 'KES',
    user_role: isOwner ? 'Business Owner (Full Enterprise Access)' : `Branch Manager (${branchInfo?.name || 'Local Branch'})`,
    access_scope: isOwner
      ? (activeBranchId ? `Branch Focused: ${branchInfo?.name} (With Enterprise HQ Visibility)` : 'Enterprise HQ (Consolidated All Branches)')
      : `Branch Isolated: ${branchInfo?.name} (Branch #${activeBranchId})`,
    active_branch: branchInfo,
    sales_last_30_days: salesSummary,
    top_selling_products: topProducts,
    low_stock_alerts: lowStock,
    customer_overview: customerStats,
    inventory_overview: inventoryStats,
    hr_overview: hrStats,
    procurement_overview: procurementStats,
    logistics_overview: logisticsStats,
    enterprise_branches_breakdown: enterpriseBranchesBreakdown
  };
}

/**
 * POST /api/ai/chat
 * Body: { message: string, sessionId?: string, history?: Array, branch_id?: string|number }
 */
async function chat(req, res) {
  // Only owner and branch managers have access to the AI Assistant
  if (req.user.role !== 'owner' && req.user.role !== 'manager') {
    return res.status(403).json({
      error: 'Access denied: The AI Business Assistant is only accessible by Business Owners and Branch Managers.'
    });
  }

  try {
    const genAI = getGenAI();
    const { message, sessionId = 'default', history = [], branch_id } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const isOwner = req.user.role === 'owner';

    // Build live business context scoped to user's branch / owner's view
    let context;
    try {
      context = await buildBusinessContext(req.user, branch_id);
    } catch (dbErr) {
      context = { note: 'Live DB context error', error: dbErr.message, date: new Date().toISOString() };
    }

    const contextJson = JSON.stringify(context, null, 2);

    let systemPrompt = '';
    const formattingRules = `
Output Formatting Rules (STRICT):
- Do NOT use markdown heading hashes (#, ##, ###). Use bold text for headings (e.g. **1. Enterprise Revenue Summary**).
- Do NOT use markdown tables or pipe (|) columns. Give straight-to-the-point answers using clean numbered points (1., 2., 3.) and bold text for headings/key metrics.
- Do NOT use asterisks (*) for bullet points or italic wrappers. Use numbers (1., 2.) or clean text.
- Provide direct, concise answers with a short 1-2 sentence explanation or key business rationale.
- Always use KES (Kenyan Shillings) for currency.
- Keep answers organized, easy to read, and immediately actionable.`;

    if (isOwner) {
      systemPrompt = `You are an executive AI business analyst and strategic advisor for OpenFloat POS X, assisting the Business Owner of OpenFloat Enterprise Ltd.

You have full enterprise-wide visibility across all branches in Kenya as of ${context.date}.

Live Data Snapshot:
\`\`\`json
${contextJson}
\`\`\`

Guidelines for Owner Assistant:
1. You have complete access to all branches. You can compare branch performance, rank locations, identify underperforming units, and summarize company-wide revenue.
2. Provide high-level executive insights, profit maximization tips, cross-branch inventory balancing advice, and cost optimizations.
3. Reference real figures from the data snapshot.
4. Always maintain a professional, sharp, and strategic tone.
${formattingRules}`;
    } else {
      const branchName = context.active_branch?.name || 'Assigned Branch';
      systemPrompt = `You are a dedicated AI business assistant for the Branch Manager of '${branchName}' at OpenFloat POS X.

You ONLY have access to the data for '${branchName}' as of ${context.date}.

Live Branch Data Snapshot:
\`\`\`json
${contextJson}
\`\`\`

Strict Privacy & Scoping Guidelines for Branch Manager:
1. You have access ONLY to data belonging to '${branchName}'. You MUST NOT reveal or fabricate information about other branches or confidential owner-only enterprise metrics.
2. Focus on branch-level operations: local sales trends, restock recommendations for low stock products, local customer accounts, cashier attendance, and daily shift performance.
3. Reference actual figures from the data snapshot above.
4. Be concise, actionable, and encouraging.
${formattingRules}`;
    }

    // Try active Gemini models in order
    const modelCandidates = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-flash-latest', 'gemini-3.5-flash'];
    let responseText = null;
    let lastError = null;

    for (const modelName of modelCandidates) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt
        });

        const chatHistory = history.map(msg => ({
          role: msg.role === 'bot' ? 'model' : 'user',
          parts: [{ text: msg.text }]
        }));

        const chatSession = model.startChat({ history: chatHistory });
        const result = await chatSession.sendMessage(message.trim());
        responseText = result.response.text();
        if (responseText) break;
      } catch (mErr) {
        lastError = mErr;
      }
    }

    if (!responseText && lastError) {
      throw lastError;
    }

    const cleanReply = formatCleanAIResponse(responseText);

    return res.json({
      reply: cleanReply,
      context_snapshot: {
        scope: context.access_scope,
        branch: context.active_branch?.name || 'All Branches',
        revenue_30d: context.sales_last_30_days?.total_revenue || 0,
        low_stock_count: context.low_stock_alerts?.length || 0,
        total_customers: context.customer_overview?.total_customers || 0
      }
    });

  } catch (err) {
    console.error('[AI Chat Error]', err.message);

    if (err.message.includes('GEMINI_API_KEY')) {
      return res.status(503).json({
        error: 'AI assistant is not configured. Please add GEMINI_API_KEY to your .env file.',
        code: 'NO_API_KEY'
      });
    }

    if (err.message.includes('429') || err.message.includes('quota') || err.message.includes('Too Many Requests')) {
      return res.status(429).json({
        error: 'Gemini API quota exceeded. Your free-tier key has hit its daily limit. Please enable billing at https://ai.dev or wait until tomorrow.',
        code: 'QUOTA_EXCEEDED'
      });
    }

    if (err.message.includes('503') || err.message.includes('Service Unavailable') || err.message.includes('high demand') || err.message.includes('overloaded')) {
      return res.status(503).json({
        error: 'The AI service is currently experiencing high demand. Please try again in a moment.',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    return res.status(500).json({
      error: 'AI service temporarily unavailable. Please try again.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
}

/**
 * GET /api/ai/insights?branch_id=...
 * Returns proactive AI-generated business insights for the sidebar panel.
 */
async function getInsights(req, res) {
  // Only owner and branch managers have access
  if (req.user.role !== 'owner' && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  try {
    const genAI = getGenAI();
    const branch_id = req.query.branch_id;

    let context;
    try {
      context = await buildBusinessContext(req.user, branch_id);
    } catch {
      return res.json({ insights: [] });
    }

    const modelCandidates = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-flash-latest', 'gemini-3.5-flash'];
    let text = null;

    const isOwner = req.user.role === 'owner';
    const prompt = `Based on this live business snapshot: ${JSON.stringify(context)}
User: ${isOwner ? 'Business Owner (Enterprise HQ / Multi-Branch View)' : 'Branch Manager (' + (context.active_branch?.name || 'Local Branch') + ')'}

Generate exactly 5 short, specific, highly actionable business insights as a JSON array.
Each insight must have:
- "type": one of "success", "warning", "danger", "info", "purple"
- "title": a bold 4-8 word headline
- "body": 1-2 sentence insight referencing actual figures from the data

Return ONLY a valid JSON array, no markdown fences, no extra text.`;

    for (const modelName of modelCandidates) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        text = result.response.text().trim();
        if (text) break;
      } catch (err) {
        // try next model candidate
      }
    }

    if (!text) return res.json({ insights: [] });

    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    let insights = [];
    try {
      insights = JSON.parse(text);
    } catch {
      insights = [];
    }

    return res.json({ insights, scope: context.access_scope });

  } catch (err) {
    console.error('[AI Insights Error]', err.message);
    return res.json({ insights: [] });
  }
}

module.exports = { chat, getInsights, buildBusinessContext };
