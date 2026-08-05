/** Batch Upload Controller — Products & Services batch CSV upload */
const { getDb, exec } = require('../db/database');

async function uploadBatch(req, res) {
  try {
    const db = await getDb();
    const { upload_type, store_warehouse, items } = req.body;

    if (!upload_type || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'upload_type and non-empty items array are required.' });
    }

    let inserted = 0;
    let errors = 0;

    if (upload_type === 'products' || upload_type === 'inventory') {
      for (const item of items) {
        try {
          const sku = item.sku || 'SKU-' + Math.floor(1000 + Math.random() * 9000);
          exec(db,
            `INSERT INTO products (name, sku, category_id, buy_price, sell_price, stock_qty, reorder_level, unit, supplier_id, expiry_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [item.name || 'Unnamed Item', sku, item.category_id || 1, item.buy_price || 0, item.sell_price || 0, item.stock_qty || 0, item.reorder_level || 10, item.unit || 'pcs', item.supplier_id || null, item.expiry_date || null]
          );
          inserted++;
        } catch (e) {
          errors++;
        }
      }
    } else if (upload_type === 'services') {
      for (const item of items) {
        try {
          const code = item.code || 'SRV-' + Math.floor(100 + Math.random() * 900);
          exec(db,
            `INSERT INTO services (code, name, category, unit, price, vat_applicable, available_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [code, item.name || 'Unnamed Service', item.category || 'General', item.unit || 'Per Session', item.price || 0, item.vat_applicable ?? 1, store_warehouse || 'All Branches']
          );
          inserted++;
        } catch (e) {
          errors++;
        }
      }
    } else {
      return res.status(400).json({ error: 'Invalid upload_type. Use "products" or "services".' });
    }

    res.json({ success: true, inserted, errors, total: items.length, message: `Batch upload finished: ${inserted} inserted, ${errors} failed.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { uploadBatch };
