/**
 * OpenFloat POS X — Clean Client Onboarding Reset Script
 *
 * Clears out ALL demo/test data from every transactional table,
 * then creates a fresh admin account for the new client.
 *
 * Usage: npm run db:reset
 */

require('dotenv').config();
const { getDb, exec } = require('./database');
const bcrypt = require('bcryptjs');

async function resetForNewClient() {
  console.log('──────────────────────────────────────────────────');
  console.log('  OpenFloat POS X — Fresh Client Onboarding Reset');
  console.log('──────────────────────────────────────────────────\n');

  const db = await getDb();

  // ── Step 1: Wipe ALL transactional / operational tables ──────────────────
  const allTables = [
    // Sales & Transactions
    'transaction_items',
    'transactions',
    'sales',
    'sale_items',
    // Payments
    'mpesa_payments',
    // Inventory
    'products',
    'stock_movements',
    'inventory_movements',
    // Customers & Credit
    'customers',
    'hire_purchase_payments',
    'hire_purchase',
    'hire_purchase_agreements',
    'receivables',
    'accounts_receivable',
    // HR
    'employees',
    'payroll',
    'attendance',
    // Procurement & Purchasing
    'purchase_request_items',
    'purchase_requests',
    'purchase_orders',
    'purchase_order_items',
    // Suppliers
    'suppliers',
    // Accounting
    'journal_entries',
    // Services
    'services',
    // Logistics
    'deliveries',
    'logistics_trips',
    // Reports
    'z_reports',
  ];

  console.log('[1/4] Wiping ALL transactional data...');
  allTables.forEach(table => {
    try {
      exec(db, `DELETE FROM ${table};`);
      exec(db, `DELETE FROM sqlite_sequence WHERE name='${table}';`);
      console.log(`  ✓ Cleared: ${table}`);
    } catch (e) {
      // Table may not exist — safely ignore
    }
  });

  // ── Step 2: Reset Users ──────────────────────────────────────────────────
  console.log('\n[2/4] Resetting Users & Security Roles...');
  try {
    exec(db, `DELETE FROM users;`);
    exec(db, `DELETE FROM sqlite_sequence WHERE name='users';`);

    const defaultPassword = process.env.INITIAL_ADMIN_PASSWORD || 'admin123';
    const passwordHash = bcrypt.hashSync(defaultPassword, 10);

    exec(db, `
      INSERT INTO users (name, email, password_hash, role, branch_id)
      VALUES 
        ('Business Admin', 'admin@openfloat.com', ?, 'owner', 1),
        ('Business Owner', 'owner@openfloat.com', ?, 'owner', 1);
    `, [passwordHash, passwordHash]);

    console.log(`  ✓ Created admin: admin@openfloat.com / ${defaultPassword}`);
  } catch (e) {
    console.error('  ✕ Error resetting users:', e.message);
  }

  // ── Step 3: Reset Branches ───────────────────────────────────────────────
  console.log('\n[3/4] Resetting Branch...');
  try {
    exec(db, `DELETE FROM branches;`);
    exec(db, `DELETE FROM sqlite_sequence WHERE name='branches';`);
    exec(db, `
      INSERT INTO branches (name, location, phone)
      VALUES ('Main Branch / HQ', 'Headquarters Store', '+254 700 000 000');
    `);
    console.log('  ✓ Created default Main Branch / HQ');
  } catch (e) {
    console.error('  ✕ Error resetting branches:', e.message);
  }

  // ── Step 4: Reset Default Settings ──────────────────────────────────────
  console.log('\n[4/4] Setting default Business Profile...');
  try {
    const defaultSettings = [
      ['business_name', 'My Store Enterprise'],
      ['support_email', 'admin@openfloat.com'],
      ['hq_phone', '+254 700 000 000'],
      ['currency', 'KES'],
      ['vat_rate', '16'],
      ['receipt_header', 'Welcome to Our Store'],
      ['receipt_footer', 'Thank you for shopping with us!'],
      ['printer', 'Generic ESC/POS Thermal Printer'],
      ['scanner', 'HID Keyboard Emulation'],
    ];

    defaultSettings.forEach(([key, val]) => {
      exec(db, `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);`, [key, val]);
    });
    console.log('  ✓ Reset default settings');
  } catch (e) {
    console.error('  ✕ Error resetting settings:', e.message);
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log('  ✅ SUCCESS! Database is clean and ready.');
  console.log('  Login Credentials:');
  console.log('    Email:    admin@openfloat.com');
  console.log('    Password: admin123');
  console.log('\n  IMPORTANT: Clear your browser cache / localStorage');
  console.log('  or open in Incognito mode before signing in!');
  console.log('──────────────────────────────────────────────────\n');
}

resetForNewClient().catch(err => {
  console.error('Reset failed:', err);
  process.exit(1);
});
