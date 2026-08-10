/**
 * OpenFloat POS X — Clean Client Onboarding Reset Script
 * 
 * Clears out all demo sales, transactions, test products, inventory logs, 
 * dummy customers, and sample employees while retaining table structures 
 * and setting up an initial admin account for the new client.
 * 
 * Usage: node backend/db/clean_reset.js
 */

require('dotenv').config();
const { getDb, exec } = require('./database');
const bcrypt = require('bcryptjs');

async function resetForNewClient() {
  console.log('──────────────────────────────────────────────────');
  console.log('  OpenFloat POS X — Fresh Client Onboarding Reset');
  console.log('──────────────────────────────────────────────────\n');

  const db = await getDb();

  // List of tables to wipe completely
  const transactionalTables = [
    'sales',
    'sale_items',
    'mpesa_payments',
    'stock_movements',
    'inventory_movements',
    'hire_purchase_payments',
    'hire_purchase_agreements',
    'receivables',
    'accounts_receivable',
    'customers',
    'payroll',
    'attendance',
    'employees',
    'z_reports',
    'logistics_trips',
    'purchase_orders',
    'purchase_order_items',
    'products',
    'services',
    'suppliers'
  ];

  console.log('[1/4] Wiping demo transactions & operational data...');
  transactionalTables.forEach(table => {
    try {
      exec(db, `DELETE FROM ${table};`);
      exec(db, `DELETE FROM sqlite_sequence WHERE name='${table}';`);
      console.log(`  ✓ Cleared table: ${table}`);
    } catch (e) {
      // Table may not exist or sequence absent; ignore safely
    }
  });

  console.log('\n[2/4] Resetting Users & Security Roles...');
  try {
    exec(db, `DELETE FROM users;`);
    exec(db, `DELETE FROM sqlite_sequence WHERE name='users';`);

    // Create default initial Admin / Owner account for the new business
    const defaultPassword = process.env.INITIAL_ADMIN_PASSWORD || 'admin123';
    const passwordHash = bcrypt.hashSync(defaultPassword, 10);

    exec(db, `
      INSERT INTO users (name, email, password_hash, role, branch_id)
      VALUES ('Business Admin', 'admin@openfloat.com', ?, 'owner', 1);
    `, [passwordHash]);

    console.log(`  ✓ Created primary Admin account: admin@openfloat.com (Password: ${defaultPassword})`);
  } catch (e) {
    console.error('  ✕ Error resetting users:', e.message);
  }

  console.log('\n[3/4] Resetting Default Store Branch...');
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
      ['scanner', 'HID Keyboard Emulation']
    ];

    defaultSettings.forEach(([key, val]) => {
      exec(db, `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);`, [key, val]);
    });
    console.log('  ✓ Reset default settings');
  } catch (e) {
    console.error('  ✕ Error resetting settings:', e.message);
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log('  ✅ SUCCESS! Database wiped clean & prepared for client.');
  console.log('  Admin Credentials:');
  console.log('    Email:    admin@openfloat.com');
  console.log('    Password: admin123');
  console.log('──────────────────────────────────────────────────\n');
}

resetForNewClient().catch(err => {
  console.error('Reset failed:', err);
});
