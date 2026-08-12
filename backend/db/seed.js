/**
 * OpenFloat POS X — Demo Data Seeder (Compatible with async sql.js database layer)
 * Run: node backend/db/seed.js
 */

require('dotenv').config();
const { getDb, exec, query } = require('./database');
const bcrypt = require('bcryptjs');

async function seed() {
  console.log('[Seed] Initializing database & starting seeder...');
  const db = await getDb();

  function run(sql, params = []) {
    try {
      exec(db, sql, params);
    } catch (e) {
      if (!e.message.includes('UNIQUE')) console.error('[Seed Error]', e.message);
    }
  }

  // ── SETTINGS ─────────────────────────────────────────────────────────────────
  const defaultSettings = [
    ['business_name', 'OpenFloat Enterprise Ltd'],
    ['kra_pin', 'P051293841Z'],
    ['support_email', 'support@openfloat.com'],
    ['hq_phone', '+254 700 000 000'],
    ['currency', 'KES'],
    ['vat_rate', '16'],
    ['receipt_header', 'OpenFloat POS X - Official Tax Receipt'],
    ['receipt_footer', 'Thank you for shopping with us!'],
    ['paybill', '400200'],
    ['printer', 'Epson TM-T88VI'],
    ['scanner', 'HID Keyboard Emulation'],
  ];
  defaultSettings.forEach(([key, value]) =>
    run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
  );
  console.log('[Seed] Settings seeded.');

  // ── BRANCHES ──────────────────────────────────────────────────────────────────
  const branches = [
    ['Main Branch', 'Kimathi Street, CBD', '+254 700 100 001'],
  ];
  branches.forEach(([name, location, phone]) =>
    run('INSERT OR IGNORE INTO branches (name, location, phone) VALUES (?, ?, ?)', [name, location, phone])
  );
  console.log('[Seed] Branches seeded.');

  // ── USERS ─────────────────────────────────────────────────────────────────────
  const passwordHash = bcrypt.hashSync('admin123', 10);
  const users = [
    ['Owner', 'owner@openfloat.com', passwordHash, 'owner', 1]
  ];
  users.forEach(([name, email, hash, role, branch_id]) =>
    run('INSERT OR IGNORE INTO users (name, email, password_hash, role, branch_id) VALUES (?, ?, ?, ?, ?)',
      [name, email, hash, role, branch_id])
  );
  console.log('[Seed] Owner user seeded.');

  // ── CATEGORIES ────────────────────────────────────────────────────────────────
  const categories = [
    ['Food & Beverages', 'food'],
    ['Electronics', 'electronics'],
    ['Household', 'household'],
    ['Clothing', 'clothing'],
    ['Personal Care', 'personal-care'],
    ['Equipment', 'equipment'],
  ];
  categories.forEach(([name, slug]) =>
    run('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)', [name, slug])
  );
  console.log('[Seed] Categories seeded.');

  // ── SUPPLIERS ─────────────────────────────────────────────────────────────────
  const suppliers = [
    ['Bidco Africa Ltd', 'Food & Household', 'Peter Njoroge', '+254 722 000 001', 'bidco@bidco.co.ke', 94],
    ['LG Electronics KE', 'Electronics', 'Sarah Mutua', '+254 722 000 002', 'lg@lg.co.ke', 88],
    ['Unilever Kenya', 'Personal Care', 'Paul Odinga', '+254 722 000 003', 'unilever@unilever.co.ke', 82],
    ['Davis & Shirtliff', 'Equipment', 'Alice Kimani', '+254 722 000 004', 'ds@ds.co.ke', 76],
  ];
  suppliers.forEach(([name, category, contact_name, phone, email, rating]) =>
    run('INSERT OR IGNORE INTO suppliers (name, category, contact_name, phone, email, rating) VALUES (?, ?, ?, ?, ?, ?)',
      [name, category, contact_name, phone, email, rating])
  );
  console.log('[Seed] Suppliers seeded.');

  // ── PRODUCTS ──────────────────────────────────────────────────────────────────
  const products = [
    ['Milk Powder 400g', 'MILK-400G', 1, 350, 520, 12, 50, 'pcs', 1, '2026-09-01'],
    ['Cooking Oil 5L', 'OIL-5L', 1, 620, 890, 48, 60, 'pcs', 1, null],
    ['Basmati Rice 5kg', 'RICE-5KG', 1, 480, 650, 65, 80, 'bags', 1, null],
    ['Fresh Yogurt 500ml', 'YGT-500ML', 1, 90, 145, 230, 100, 'pcs', 1, '2026-07-28'],
    ['Bleach 1L', 'BLEACH-1L', 3, 55, 90, 0, 30, 'pcs', 3, null],
    ['Samsung Smart TV 43"', 'TV-SMSNG-43', 2, 28000, 38500, 15, 5, 'pcs', 2, null],
    ['LG Refrigerator 200L', 'FRDG-LG-200', 2, 32000, 45000, 8, 3, 'pcs', 2, null],
    ['Detergent 1kg', 'DETG-1KG', 3, 120, 195, 340, 100, 'pcs', 3, null],
    ['Men\'s T-Shirt (L)', 'SHIRT-M-L', 4, 450, 850, 120, 40, 'pcs', null, null],
    ['Women\'s Dress (M)', 'DRESS-W-M', 4, 650, 1200, 85, 30, 'pcs', null, null],
    ['Loofah Sponge', 'LOOFA-001', 5, 45, 85, 200, 60, 'pcs', 3, null],
    ['Shampoo 400ml', 'SHMP-400ML', 5, 280, 420, 95, 40, 'pcs', 3, null],
  ];
  products.forEach(([name, sku, cat, buy, sell, qty, reorder, unit, sup, exp]) =>
    run(`INSERT OR IGNORE INTO products (name, sku, category_id, buy_price, sell_price, stock_qty, reorder_level, unit, supplier_id, expiry_date, branch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [name, sku, cat, buy, sell, qty, reorder, unit, sup, exp])
  );
  console.log('[Seed] Products seeded.');

  // ── CUSTOMERS ─────────────────────────────────────────────────────────────────
  const customers = [
    ['John Mwenda', '+254 711 000 001', 'john@email.com', 840, 0, 0, 'regular', 1],
    ['Amina Khalid', '+254 711 000 002', 'amina@email.com', 2100, 5000, 0, 'vip', 1],
    ['Faith Wanjiku', '+254 711 000 003', 'faith@email.com', 320, 10000, 6750, 'regular', 1],
    ['Kama Superstore', '+254 711 000 004', 'orders@kama.co.ke', 0, 500000, 480000, 'b2b', 1],
    ['Hotel Paradise', '+254 711 000 005', 'purchasing@hotelparadise.co.ke', 0, 200000, 67200, 'b2b', 1],
    ['Daniel Mutua', '+254 711 000 006', 'daniel@email.com', 150, 0, 0, 'regular', 2],
  ];
  customers.forEach(([name, phone, email, pts, limit, balance, seg, branch]) =>
    run(`INSERT OR IGNORE INTO customers (name, phone, email, loyalty_points, credit_limit, credit_balance, segment, branch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, phone, email, pts, limit, balance, seg, branch])
  );
  console.log('[Seed] Customers seeded.');

  // ── EMPLOYEES ─────────────────────────────────────────────────────────────────
  const employees = [
    ['James Mwangi', 'Cashier', 1, 28000, '+254 722 100 001', 'james.m@openfloat.com', '2024-01-15', 'absent', 87],
    ['Grace Odhiambo', 'Accountant', 2, 52000, '+254 722 100 002', 'grace.o@openfloat.com', '2023-06-01', 'on_leave', 94],
    ['David Kamau', 'Store Manager', 1, 65000, '+254 722 100 003', 'david.k@openfloat.com', '2022-03-10', 'present', 98],
    ['Nancy Wambui', 'HR Officer', 1, 48000, '+254 722 100 004', 'nancy.w@openfloat.com', '2023-01-20', 'present', 96],
    ['Peter Odhiambo', 'Driver', 1, 35000, '+254 722 100 005', 'peter.o@openfloat.com', '2024-05-01', 'present', 91],
  ];
  employees.forEach(([name, role, branch, salary, phone, email, hire, status, att]) =>
    run(`INSERT OR IGNORE INTO employees (name, role, branch_id, salary, phone, email, hire_date, status, attendance_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, role, branch, salary, phone, email, hire, status, att])
  );
  console.log('[Seed] Employees seeded.');

  // ── DELIVERIES ────────────────────────────────────────────────────────────────
  const deliveries = [
    ['DEL-0441', 4, 'Peter Odhiambo', 'Van #1', 'Nairobi Main Branch', 'Kama Superstore, Westlands', 'in_transit', '15 min'],
    ['DEL-0440', 5, 'Peter Odhiambo', 'Van #2', 'Nairobi Main Branch', 'Hotel Paradise, Upper Hill', 'in_transit', '8 min'],
    ['DEL-0439', 6, 'James Mwangi', 'Van #3', 'Nairobi Main Branch', 'City Mart, Eastlands', 'delayed', '22 min late'],
    ['DEL-0438', null, null, null, 'Nairobi Main Branch', 'Nakumatt Prestige', 'pending', null],
  ];
  deliveries.forEach(([ref, cust, driver, van, origin, dest, status, eta]) =>
    run(`INSERT OR IGNORE INTO deliveries (ref, customer_id, driver_name, van_number, origin, destination, status, eta, branch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [ref, cust, driver, van, origin, dest, status, eta])
  );
  console.log('[Seed] Deliveries seeded.');

  // ── SERVICES ──────────────────────────────────────────────────────────────────
  const services = [
    ['SRV-001', 'Vehicle Inspection', 'Automotive', 'Per Session', 3500, 1, 'All Branches'],
    ['SRV-002', 'Delivery Fee (CBD)', 'Logistics', 'Per Trip', 500, 0, 'Nairobi Main'],
    ['SRV-003', 'Installation Service', 'Electronics', 'Per Unit', 2000, 1, 'All Branches'],
    ['SRV-004', 'Equipment Repair', 'Maintenance', 'Per Hour', 1500, 1, 'Westlands Branch'],
  ];
  services.forEach(([code, name, category, unit, price, vat, available]) =>
    run(`INSERT OR IGNORE INTO services (code, name, category, unit, price, vat_applicable, available_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [code, name, category, unit, price, vat, available])
  );
  console.log('[Seed] Services seeded.');

  // ── STOCK MOVEMENTS ───────────────────────────────────────────────────────────
  const stockMovements = [
    ['MOV-0841', 2, 'Cooking Oil 5L', 'OIL-5L', 'SALE', -3, 'TXN-20260729-A1B2', 'James Mwangi', 'Nairobi Main'],
    ['MOV-0840', 3, 'Samsung TV 43"', 'TV-SMSNG-43', 'RETURN', 1, 'Customer Return - Defective', 'David Kamau', 'Nairobi Main'],
    ['MOV-0839', 4, 'Fresh Yogurt 500ml', 'YGT-500ML', 'EXPIRY', -24, 'Batch expired Jul 28', 'Nancy Wambui', 'Nairobi Main'],
    ['MOV-0838', 5, 'Bleach 1L', 'BLEACH-1L', 'DAMAGE', -6, 'Warehouse spillage', 'Peter Odhiambo', 'Nairobi Main'],
    ['MOV-0837', 3, 'Basmati Rice 5kg', 'RICE-5KG', 'ADJUSTMENT', 50, 'Stock recount correction', 'David Kamau', 'Nairobi Main'],
    ['MOV-0836', 1, 'Milk Powder 400g', 'MILK-400G', 'PURCHASE', 100, 'PR-2341 - Bidco Africa', 'David Kamau', 'Nairobi Main'],
  ];
  stockMovements.forEach(([ref, pId, pName, sku, mType, qty, reason, recBy, branch]) =>
    run(`INSERT OR IGNORE INTO stock_movements (ref, product_id, product_name, sku, movement_type, qty_change, reason, recorded_by, branch_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ref, pId, pName, sku, mType, qty, reason, recBy, branch])
  );
  console.log('[Seed] Stock movements seeded.');

  // ── HIRE PURCHASE ─────────────────────────────────────────────────────────────
  const hirePurchase = [
    ['HP-2026-001', 'Amina Khalid', '+254 711 000 002', 'Samsung TV 43"', 38500, 10000, 5750, 3, 21250, '2026-08-05', 'active'],
    ['HP-2026-002', 'Faith Wanjiku', '+254 711 000 003', 'LG Fridge 200L', 45000, 15000, 6000, 2, 27000, '2026-08-10', 'overdue'],
  ];
  hirePurchase.forEach(([ref, cName, cPhone, item, total, down, monthly, paid, bal, next, st]) =>
    run(`INSERT OR IGNORE INTO hire_purchase (ref, customer_name, customer_phone, item_name, total_value, down_payment, monthly_instalment, paid_instalments, balance, next_due, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ref, cName, cPhone, item, total, down, monthly, paid, bal, next, st])
  );
  console.log('[Seed] Hire Purchase seeded.');

  console.log('\n[Seed] All demo data seeded successfully!');
  console.log('[Seed] Owner login: owner@openfloat.com / admin123');
  process.exit(0);
}

seed().catch(err => {
  console.error('[Seed Fatal Error]', err);
  process.exit(1);
});
