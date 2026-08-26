/** Batch Upload Controller — Products & Services batch CSV upload */
const { getDb, exec, query } = require('../db/database');

function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return url || null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const driveMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (driveMatch && driveMatch[1]) {
    return 'https://lh3.googleusercontent.com/d/' + driveMatch[1];
  }
  return trimmed;
}

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
      // Cache of category names to IDs to minimize queries in batch
      const catCache = new Map();

      for (const item of items) {
        try {
          const sku = item.sku || 'SKU-' + Math.floor(1000 + Math.random() * 9000);
          const rawCat = (item.category || item.category_name || item.cat || '').trim();
          let categoryId = null;

          if (rawCat) {
            const lowerCat = rawCat.toLowerCase();
            if (catCache.has(lowerCat)) {
              categoryId = catCache.get(lowerCat);
            } else {
              const slug = lowerCat.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || ('cat-' + Date.now());
              const existing = query(db, 'SELECT id FROM categories WHERE LOWER(name) = LOWER(?) OR LOWER(slug) = LOWER(?)', [rawCat, slug]);
              if (existing && existing.length > 0) {
                categoryId = existing[0].id;
              } else {
                const insRes = exec(db, 'INSERT INTO categories (name, slug) VALUES (?, ?)', [rawCat, slug]);
                categoryId = insRes.lastInsertRowid;
              }
              catCache.set(lowerCat, categoryId);
            }
          } else if (item.category_id && !isNaN(parseInt(item.category_id))) {
            categoryId = parseInt(item.category_id);
          } else {
            // Default to General category if none specified
            const defaultCat = query(db, 'SELECT id FROM categories WHERE LOWER(name) = "general" OR LOWER(slug) = "general" LIMIT 1');
            if (defaultCat && defaultCat.length > 0) {
              categoryId = defaultCat[0].id;
            } else {
              const insGen = exec(db, 'INSERT INTO categories (name, slug) VALUES ("General", "general")');
              categoryId = insGen.lastInsertRowid;
            }
          }

          const rawImg = item.image_url || item.image || item.img || null;
          const imageUrl = normalizeImageUrl(rawImg);
          exec(db,
            `INSERT INTO products (name, sku, category_id, buy_price, sell_price, stock_qty, reorder_level, unit, supplier_id, expiry_date, image_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [item.name || 'Unnamed Item', sku, categoryId, parseFloat(item.buy_price) || 0, parseFloat(item.sell_price) || 0, parseInt(item.stock_qty) || 0, parseInt(item.reorder_level) || 10, item.unit || 'pcs', item.supplier_id || null, item.expiry_date || null, imageUrl]
          );
          inserted++;
        } catch (e) {
          console.error('[uploadBatch] Product insert error:', e.message);
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
            [code, item.name || 'Unnamed Service', item.category || 'General', item.unit || 'Per Session', parseFloat(item.price) || 0, item.vat_applicable ?? 1, store_warehouse || 'All Branches']
          );
          inserted++;
        } catch (e) {
          console.error('[uploadBatch] Service insert error:', e.message);
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
