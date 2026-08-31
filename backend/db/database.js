/**
 * OpenFloat POS X — Database Layer (sql.js — pure JS SQLite, no native build needed)
 *
 * sql.js runs SQLite entirely in WebAssembly/JavaScript. The database is loaded
 * from disk on start and persisted back to disk on every write operation.
 */

require('dotenv').config();
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(process.env.DB_PATH || './backend/db/openfloat.db');

// Ensure db directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

let _db = null;

/**
 * Initialise (or load) the SQLite database.
 * Returns the sql.js Database instance.
 */
async function getDb() {
  if (_db) return _db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
  } else {
    _db = new SQL.Database();
  }

  // Performance-equivalent pragmas
  _db.run('PRAGMA foreign_keys = ON;');

  createTables();
  return _db;
}

/** Persist the in-memory database to disk. Call after every write. */
function persist() {
  if (!_db) return;
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/** Create all application tables */
function createTables() {
  _db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS branches (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      location   TEXT,
      phone      TEXT,
      is_active  INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'cashier',
      branch_id     INTEGER,
      is_active     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      category     TEXT,
      contact_name TEXT,
      phone        TEXT,
      email        TEXT,
      rating       REAL DEFAULT 0,
      is_active    INTEGER DEFAULT 1,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      sku           TEXT NOT NULL,
      category_id   INTEGER,
      buy_price     REAL NOT NULL DEFAULT 0,
      sell_price    REAL NOT NULL DEFAULT 0,
      stock_qty     INTEGER NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 10,
      unit          TEXT DEFAULT 'pcs',
      supplier_id   INTEGER,
      expiry_date   TEXT,
      image_url     TEXT,
      is_active     INTEGER DEFAULT 1,
      branch_id     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      phone          TEXT UNIQUE,
      email          TEXT,
      loyalty_points INTEGER DEFAULT 0,
      credit_limit   REAL DEFAULT 0,
      credit_balance REAL DEFAULT 0,
      segment        TEXT DEFAULT 'regular',
      branch_id      INTEGER,
      created_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      ref            TEXT NOT NULL UNIQUE,
      customer_id    INTEGER,
      cashier_id     INTEGER,
      branch_id      INTEGER,
      subtotal       REAL NOT NULL DEFAULT 0,
      discount       REAL NOT NULL DEFAULT 0,
      vat            REAL NOT NULL DEFAULT 0,
      total          REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      status         TEXT NOT NULL DEFAULT 'completed',
      notes          TEXT,
      created_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transaction_items (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      product_id     INTEGER NOT NULL,
      qty            INTEGER NOT NULL DEFAULT 1,
      unit_price     REAL NOT NULL,
      discount       REAL NOT NULL DEFAULT 0,
      line_total     REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employees (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      role               TEXT NOT NULL,
      branch_id          INTEGER,
      salary             REAL NOT NULL DEFAULT 0,
      hourly_rate        REAL NOT NULL DEFAULT 250,
      commission_pct     REAL NOT NULL DEFAULT 0,
      statutory_paye_pct REAL NOT NULL DEFAULT 10,
      statutory_nssf     REAL NOT NULL DEFAULT 1080,
      statutory_nhif     REAL NOT NULL DEFAULT 1700,
      benefits_deduction REAL NOT NULL DEFAULT 0,
      phone              TEXT,
      email              TEXT,
      hire_date          TEXT,
      status             TEXT DEFAULT 'active',
      attendance_pct     REAL DEFAULT 100,
      created_at         TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'present',
      notes       TEXT,
      UNIQUE(employee_id, date)
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id      INTEGER NOT NULL,
      branch_id        INTEGER NOT NULL,
      clock_in         TEXT NOT NULL,
      clock_out        TEXT,
      regular_hours    REAL DEFAULT 0,
      overtime_hours   REAL DEFAULT 0,
      hourly_rate      REAL DEFAULT 250,
      shift_type       TEXT DEFAULT 'day',
      differential_pct REAL DEFAULT 0,
      status           TEXT DEFAULT 'open',
      created_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payroll_records (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id        INTEGER NOT NULL,
      branch_id          INTEGER NOT NULL,
      period_start       TEXT NOT NULL,
      period_end         TEXT NOT NULL,
      regular_pay        REAL DEFAULT 0,
      overtime_pay       REAL DEFAULT 0,
      differential_pay   REAL DEFAULT 0,
      commission_pay     REAL DEFAULT 0,
      tips_pay           REAL DEFAULT 0,
      gross_earnings     REAL DEFAULT 0,
      tax_paye           REAL DEFAULT 0,
      statutory_nssf     REAL DEFAULT 0,
      statutory_nhif     REAL DEFAULT 0,
      shortage_deduction REAL DEFAULT 0,
      benefits_deduction REAL DEFAULT 0,
      total_deductions   REAL DEFAULT 0,
      net_pay            REAL DEFAULT 0,
      status             TEXT DEFAULT 'approved',
      created_at         TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id      INTEGER NOT NULL,
      branch_id        INTEGER NOT NULL,
      clock_in         TEXT NOT NULL,
      clock_out        TEXT,
      regular_hours    REAL DEFAULT 0,
      overtime_hours   REAL DEFAULT 0,
      hourly_rate      REAL DEFAULT 250,
      shift_type       TEXT DEFAULT 'day',
      differential_pct REAL DEFAULT 0,
      status           TEXT DEFAULT 'open',
      created_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payroll_records (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id        INTEGER NOT NULL,
      branch_id          INTEGER NOT NULL,
      period_start       TEXT NOT NULL,
      period_end         TEXT NOT NULL,
      regular_pay        REAL DEFAULT 0,
      overtime_pay       REAL DEFAULT 0,
      differential_pay   REAL DEFAULT 0,
      commission_pay     REAL DEFAULT 0,
      tips_pay           REAL DEFAULT 0,
      gross_earnings     REAL DEFAULT 0,
      tax_paye           REAL DEFAULT 0,
      statutory_nssf     REAL DEFAULT 0,
      statutory_nhif     REAL DEFAULT 0,
      shortage_deduction REAL DEFAULT 0,
      benefits_deduction REAL DEFAULT 0,
      total_deductions   REAL DEFAULT 0,
      net_pay            REAL DEFAULT 0,
      status             TEXT DEFAULT 'approved',
      created_at         TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_requests (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ref          TEXT NOT NULL UNIQUE,
      requested_by INTEGER,
      supplier_id  INTEGER,
      total_value  REAL NOT NULL DEFAULT 0,
      item_count   INTEGER NOT NULL DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'pending',
      notes        TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_request_items (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_request_id INTEGER NOT NULL,
      product_id          INTEGER,
      product_name        TEXT NOT NULL,
      qty                 INTEGER NOT NULL DEFAULT 1,
      unit_cost           REAL NOT NULL,
      line_total          REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ref         TEXT NOT NULL UNIQUE,
      type        TEXT NOT NULL,
      category    TEXT,
      description TEXT NOT NULL,
      amount      REAL NOT NULL,
      branch_id   INTEGER,
      created_by  INTEGER,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ref         TEXT NOT NULL UNIQUE,
      customer_id INTEGER,
      driver_name TEXT,
      van_number  TEXT,
      origin      TEXT,
      destination TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      eta         TEXT,
      branch_id   INTEGER,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      code           TEXT NOT NULL UNIQUE,
      name           TEXT NOT NULL,
      category       TEXT DEFAULT 'General',
      unit           TEXT DEFAULT 'Per Session',
      price          REAL NOT NULL DEFAULT 0,
      vat_applicable INTEGER DEFAULT 1,
      available_at   TEXT DEFAULT 'All Branches',
      is_active      INTEGER DEFAULT 1,
      created_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ref           TEXT NOT NULL UNIQUE,
      product_id    INTEGER,
      product_name  TEXT NOT NULL,
      sku           TEXT,
      movement_type TEXT NOT NULL,
      qty_change    INTEGER NOT NULL,
      reason        TEXT,
      recorded_by   TEXT,
      branch_name   TEXT DEFAULT 'Nairobi Main',
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hire_purchase (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      ref                TEXT NOT NULL UNIQUE,
      customer_name      TEXT NOT NULL,
      customer_phone     TEXT,
      item_name          TEXT NOT NULL,
      total_value        REAL NOT NULL DEFAULT 0,
      down_payment       REAL NOT NULL DEFAULT 0,
      monthly_instalment REAL NOT NULL DEFAULT 0,
      paid_instalments   INTEGER DEFAULT 0,
      balance            REAL NOT NULL DEFAULT 0,
      next_due           TEXT,
      status             TEXT DEFAULT 'active',
      created_at         TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hire_purchase_payments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      agreement_id INTEGER NOT NULL,
      amount       REAL NOT NULL,
      payment_date TEXT DEFAULT (datetime('now')),
      payment_mode TEXT DEFAULT 'M-Pesa',
      receipt_ref  TEXT,
      recorded_by  TEXT
    );

    CREATE TABLE IF NOT EXISTS z_reports (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      report_no     TEXT NOT NULL UNIQUE,
      cashier_name  TEXT,
      manager_name  TEXT,
      branch_name   TEXT DEFAULT 'Nairobi Main',
      report_type   TEXT NOT NULL,
      period_label  TEXT,
      opening_float REAL DEFAULT 0,
      total_sales   REAL DEFAULT 0,
      cash_sales    REAL DEFAULT 0,
      mpesa_sales   REAL DEFAULT 0,
      card_sales    REAL DEFAULT 0,
      credit_sales  REAL DEFAULT 0,
      discounts     REAL DEFAULT 0,
      vat_collected REAL DEFAULT 0,
      net_revenue   REAL DEFAULT 0,
      closing_cash  REAL DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now'))
    );
  `);
  // Migrations for existing databases
  try { _db.run("ALTER TABLE products ADD COLUMN image_url TEXT"); } catch (e) {}
  try { _db.run("ALTER TABLE products ADD COLUMN branch_id INTEGER DEFAULT 1"); } catch (e) {}
  try { _db.run("UPDATE products SET branch_id = 1 WHERE branch_id IS NULL"); } catch (e) {}
  try { _db.run("ALTER TABLE stock_movements ADD COLUMN branch_id INTEGER DEFAULT 1"); } catch (e) {}
  try { _db.run("ALTER TABLE stock_movements ADD COLUMN from_branch_id INTEGER"); } catch (e) {}
  try { _db.run("ALTER TABLE stock_movements ADD COLUMN to_branch_id INTEGER"); } catch (e) {}

  // Migrate products table if it still has old global UNIQUE(sku) constraint
  try {
    const tableInfo = query(_db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='products'");
    if (tableInfo.length > 0 && tableInfo[0].sql && tableInfo[0].sql.includes('sku') && tableInfo[0].sql.includes('UNIQUE')) {
      _db.run(`
        CREATE TABLE products_v2 (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          name          TEXT NOT NULL,
          sku           TEXT NOT NULL,
          category_id   INTEGER,
          buy_price     REAL NOT NULL DEFAULT 0,
          sell_price    REAL NOT NULL DEFAULT 0,
          stock_qty     INTEGER NOT NULL DEFAULT 0,
          reorder_level INTEGER NOT NULL DEFAULT 10,
          unit          TEXT DEFAULT 'pcs',
          supplier_id   INTEGER,
          expiry_date   TEXT,
          image_url     TEXT,
          is_active     INTEGER DEFAULT 1,
          branch_id     INTEGER DEFAULT 1,
          created_at    TEXT DEFAULT (datetime('now')),
          updated_at    TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO products_v2 (id, name, sku, category_id, buy_price, sell_price, stock_qty, reorder_level, unit, supplier_id, expiry_date, image_url, is_active, branch_id, created_at, updated_at)
        SELECT id, name, sku, category_id, buy_price, sell_price, stock_qty, reorder_level, unit, supplier_id, expiry_date, image_url, is_active, COALESCE(branch_id, 1), created_at, updated_at FROM products;
        DROP TABLE products;
        ALTER TABLE products_v2 RENAME TO products;
      `);
      console.log('[DB] Migrated products table to allow identical SKUs across independent branches.');
    }
  } catch (err) {
    console.warn('[DB] Products table migration notice:', err.message);
  }

  // Ensure unique index on attendance(employee_id, date) for upsert support
  try {
    _db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance(employee_id, date)");
  } catch (e) {
    console.warn('[DB] Attendance unique index creation notice:', e.message);
  }

  // Add branch_id to hire_purchase (isolates HP agreements per branch)
  try { _db.run("ALTER TABLE hire_purchase ADD COLUMN branch_id INTEGER"); } catch (e) {}

  // Add branch_id to purchase_requests (isolates procurement per branch)
  try { _db.run("ALTER TABLE purchase_requests ADD COLUMN branch_id INTEGER"); } catch (e) {}

  // Payroll & time-tracking migrations for existing databases
  try { _db.run("ALTER TABLE employees ADD COLUMN hourly_rate REAL NOT NULL DEFAULT 250"); } catch (e) {}
  try { _db.run("ALTER TABLE employees ADD COLUMN commission_pct REAL NOT NULL DEFAULT 0"); } catch (e) {}
  try { _db.run("ALTER TABLE employees ADD COLUMN statutory_paye_pct REAL NOT NULL DEFAULT 10"); } catch (e) {}
  try { _db.run("ALTER TABLE employees ADD COLUMN statutory_nssf REAL NOT NULL DEFAULT 1080"); } catch (e) {}
  try { _db.run("ALTER TABLE employees ADD COLUMN statutory_nhif REAL NOT NULL DEFAULT 1700"); } catch (e) {}
  try { _db.run("ALTER TABLE employees ADD COLUMN benefits_deduction REAL NOT NULL DEFAULT 0"); } catch (e) {}
  try { _db.run(`CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, branch_id INTEGER NOT NULL,
    clock_in TEXT NOT NULL, clock_out TEXT, regular_hours REAL DEFAULT 0, overtime_hours REAL DEFAULT 0,
    hourly_rate REAL DEFAULT 250, shift_type TEXT DEFAULT 'day', differential_pct REAL DEFAULT 0,
    status TEXT DEFAULT 'open', created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  try { _db.run(`CREATE TABLE IF NOT EXISTS payroll_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, branch_id INTEGER NOT NULL,
    period_start TEXT NOT NULL, period_end TEXT NOT NULL, regular_pay REAL DEFAULT 0, overtime_pay REAL DEFAULT 0,
    differential_pay REAL DEFAULT 0, commission_pay REAL DEFAULT 0, tips_pay REAL DEFAULT 0,
    gross_earnings REAL DEFAULT 0, tax_paye REAL DEFAULT 0, statutory_nssf REAL DEFAULT 0,
    statutory_nhif REAL DEFAULT 0, shortage_deduction REAL DEFAULT 0, benefits_deduction REAL DEFAULT 0,
    total_deductions REAL DEFAULT 0, net_pay REAL DEFAULT 0, status TEXT DEFAULT 'approved',
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}

  persist();
  console.log('[DB] Tables ready.');
}

/**
 * Helper: run a SELECT query and return all rows as plain objects.
 */
function query(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Helper: run an INSERT/UPDATE/DELETE and return { changes, lastInsertRowid }.
 */
function exec(db, sql, params = []) {
  db.run(sql, params);
  const meta = query(db, 'SELECT changes() as changes, last_insert_rowid() as lastId');
  persist();
  return { changes: meta[0]?.changes || 0, lastInsertRowid: meta[0]?.lastId || null };
}

module.exports = { getDb, persist, query, exec };
