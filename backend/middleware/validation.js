/**
 * OpenFloat POS X — Joi Schema Validation Middleware
 * 
 * Enforces string trimming, length bounds, HTML/script tag stripping,
 * and strict payload structure across API endpoints.
 */

const Joi = require('joi');
const { scrubHtml } = require('../utils/sanitizer');

// Extended Joi instance: automatically scrubs HTML/script tags and trims whitespace for any string
const customJoi = Joi.extend((joi) => ({
  type: 'string',
  base: joi.string(),
  prepare(value, helpers) {
    if (typeof value === 'string') {
      return { value: scrubHtml(value).trim() };
    }
  }
}));

// Clean string shortcut: trimmed, HTML-scrubbed, length-bounded (default max 255)
const cleanString = (max = 255) => customJoi.string().max(max);

// Raw string shortcut (for passwords/hashes where special chars like < or > are legitimate)
const rawString = (max = 128) => Joi.string().trim().max(max);

/**
 * Middleware generator for validating request source (default 'body')
 * @param {Joi.Schema} schema 
 * @param {'body'|'query'|'params'} [source='body']
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = req[source] || {};
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true, // drop unknown fields to prevent mass assignment
      allowUnknown: false
    });

    if (error) {
      const details = error.details.map(d => d.message.replace(/['"]/g, ''));
      return res.status(400).json({
        error: 'Validation error',
        details,
        message: details.join('; ')
      });
    }

    req[source] = value;
    next();
  };
}

// ─────────────────────────────────────────────────────────────
// SCHEMAS
// ─────────────────────────────────────────────────────────────

const schemas = {
  // ── Auth ──
  // login: controller reads req.body.email and req.body.password
  login: customJoi.object({
    email: customJoi.string().email().max(150).required(),
    password: rawString(128).min(1).required()
  }),

  // register: controller reads name, email, password, role, branch_id
  register: customJoi.object({
    name: cleanString(100).min(2).required(),
    email: customJoi.string().email().max(150).required(),
    password: rawString(128).min(8).required(),
    role: cleanString(50).valid('owner', 'manager', 'cashier', 'accountant', 'hr').default('cashier'),
    branch_id: Joi.number().integer().positive().allow(null).optional()
  }),

  // changePassword: controller reads current_password and new_password
  updatePassword: customJoi.object({
    current_password: rawString(128).min(1).required(),
    new_password: rawString(128).min(8).required()
  }),

  // ── Inventory / Products ──
  createProduct: customJoi.object({
    name: cleanString(200).min(1).required(),
    sku: cleanString(100).min(1).required(),
    category: cleanString(100).min(1).required(),
    buy_price: Joi.number().min(0).required(),
    sell_price: Joi.number().min(0).required(),
    stock_qty: Joi.number().integer().default(0),
    reorder_level: Joi.number().integer().min(0).default(10),
    barcode: cleanString(100).allow('', null).optional(),
    branch_id: Joi.number().integer().positive().allow(null).optional(),
    supplier_id: Joi.number().integer().positive().allow(null).optional(),
    unit: cleanString(50).allow('', null).optional(),
    description: cleanString(1000).allow('', null).optional(),
    image_url: cleanString(500).allow('', null).optional()
  }),

  updateProduct: customJoi.object({
    name: cleanString(200).min(1).optional(),
    sku: cleanString(100).min(1).optional(),
    category: cleanString(100).min(1).optional(),
    buy_price: Joi.number().min(0).optional(),
    sell_price: Joi.number().min(0).optional(),
    stock_qty: Joi.number().integer().optional(),
    reorder_level: Joi.number().integer().min(0).optional(),
    barcode: cleanString(100).allow('', null).optional(),
    branch_id: Joi.number().integer().positive().allow(null).optional(),
    supplier_id: Joi.number().integer().positive().allow(null).optional(),
    unit: cleanString(50).allow('', null).optional(),
    description: cleanString(1000).allow('', null).optional(),
    image_url: cleanString(500).allow('', null).optional(),
    is_active: Joi.number().valid(0, 1).optional()
  }).min(1),

  stockAdjustment: customJoi.object({
    adjustment: Joi.number().integer().not(0).required(),
    reason: cleanString(255).allow('', null).optional()
  }),

  // ── Sales ──
  checkout: customJoi.object({
    items: Joi.array().items(
      customJoi.object({
        id: Joi.number().integer().positive().optional(),
        product_id: Joi.number().integer().positive().optional(),
        name: cleanString(200).optional(),
        qty: Joi.number().positive().required(),
        price: Joi.number().min(0).required(),
        discount: Joi.number().min(0).default(0)
      })
    ).min(1).required(),
    customer_id: Joi.number().integer().positive().allow(null).optional(),
    payment_method: cleanString(50).valid('cash', 'mpesa', 'card', 'credit', 'split').default('cash'),
    branch_id: Joi.number().integer().positive().allow(null).optional(),
    discount: Joi.number().min(0).default(0),
    notes: cleanString(500).allow('', null).optional(),
    amount_tendered: Joi.number().min(0).optional(),
    change_due: Joi.number().min(0).optional(),
    receipt_number: cleanString(100).allow('', null).optional(),
    split_details: Joi.array().items(
      customJoi.object({
        method: cleanString(50).required(),
        amount: Joi.number().positive().required()
      })
    ).optional()
  }),

  // ── CRM / Customers ──
  createCustomer: customJoi.object({
    name: cleanString(150).min(1).required(),
    phone: cleanString(30).allow('', null).optional(),
    email: customJoi.string().email().max(100).allow('', null).optional(),
    segment: cleanString(50).valid('retail', 'regular', 'b2b', 'wholesale', 'vip').default('regular'),
    credit_limit: Joi.number().min(0).default(0),
    notes: cleanString(500).allow('', null).optional(),
    branch_id: Joi.number().integer().positive().allow(null).optional(),
    tax_pin: cleanString(50).allow('', null).optional(),
    address: cleanString(255).allow('', null).optional()
  }),

  updateCustomer: customJoi.object({
    name: cleanString(150).min(1).optional(),
    phone: cleanString(30).allow('', null).optional(),
    email: customJoi.string().email().max(100).allow('', null).optional(),
    segment: cleanString(50).valid('retail', 'regular', 'b2b', 'wholesale', 'vip').optional(),
    credit_limit: Joi.number().min(0).optional(),
    credit_balance: Joi.number().optional(),
    notes: cleanString(500).allow('', null).optional(),
    branch_id: Joi.number().integer().positive().allow(null).optional(),
    tax_pin: cleanString(50).allow('', null).optional(),
    address: cleanString(255).allow('', null).optional()
  }).min(1),

  adjustCustomerCredit: customJoi.object({
    amount: Joi.number().not(0).required(),
    reason: cleanString(255).allow('', null).optional()
  }),

  // ── Suppliers ──
  createSupplier: customJoi.object({
    name: cleanString(150).min(1).required(),
    contact_person: cleanString(100).allow('', null).optional(),
    phone: cleanString(30).allow('', null).optional(),
    email: customJoi.string().email().max(100).allow('', null).optional(),
    address: cleanString(255).allow('', null).optional(),
    lead_time_days: Joi.number().integer().min(0).default(3),
    category: cleanString(100).allow('', null).optional(),
    tax_pin: cleanString(50).allow('', null).optional()
  }),

  updateSupplier: customJoi.object({
    name: cleanString(150).min(1).optional(),
    contact_person: cleanString(100).allow('', null).optional(),
    phone: cleanString(30).allow('', null).optional(),
    email: customJoi.string().email().max(100).allow('', null).optional(),
    address: cleanString(255).allow('', null).optional(),
    lead_time_days: Joi.number().integer().min(0).optional(),
    category: cleanString(100).allow('', null).optional(),
    tax_pin: cleanString(50).allow('', null).optional()
  }).min(1),

  // ── Services / Bookings ──
  createService: customJoi.object({
    code: cleanString(50).allow('', null).optional(),
    name: cleanString(150).min(1).required(),
    category: cleanString(100).allow('', null).optional(),
    unit: cleanString(50).allow('', null).optional(),
    price: Joi.number().min(0).required(),
    vat_applicable: Joi.number().valid(0, 1).default(1),
    available_at: cleanString(100).allow('', null).optional()
  }),

  updateService: customJoi.object({
    name: cleanString(150).min(1).optional(),
    category: cleanString(100).allow('', null).optional(),
    unit: cleanString(50).allow('', null).optional(),
    price: Joi.number().min(0).optional(),
    vat_applicable: Joi.number().valid(0, 1).optional(),
    available_at: cleanString(100).allow('', null).optional()
  }).min(1),

  createBooking: customJoi.object({
    customer_id: Joi.number().integer().positive().allow(null).optional(),
    customer_name: cleanString(150).allow('', null).optional(),
    customer_phone: cleanString(30).allow('', null).optional(),
    service_name: cleanString(150).min(1).required(),
    booking_time: cleanString(50).min(1).required(),
    vehicle_reg: cleanString(50).allow('', null).optional(),
    assigned_staff: cleanString(100).allow('', null).optional(),
    notes: cleanString(500).allow('', null).optional(),
    price: Joi.number().min(0).default(0),
    branch_id: Joi.number().integer().positive().allow(null).optional()
  }),

  updateBooking: customJoi.object({
    status: cleanString(50).valid('pending', 'in_progress', 'completed', 'cancelled').optional(),
    assigned_staff: cleanString(100).allow('', null).optional(),
    notes: cleanString(500).allow('', null).optional(),
    price: Joi.number().min(0).optional()
  }).min(1),

  // ── Roles & RBAC ──
  // createRole: controller receives { name, description, base_role, permissions: { sales: true, ... } }
  createRole: customJoi.object({
    name: cleanString(100).min(2).required(),
    description: cleanString(255).allow('', null).optional(),
    base_role: cleanString(50).valid('manager', 'cashier', 'hr', 'accountant').required(),
    permissions: Joi.object().pattern(Joi.string(), Joi.boolean()).default({})
  }),

  updateRole: customJoi.object({
    name: cleanString(100).min(2).optional(),
    description: cleanString(255).allow('', null).optional(),
    base_role: cleanString(50).valid('manager', 'cashier', 'hr', 'accountant').optional(),
    permissions: Joi.object().pattern(Joi.string(), Joi.boolean()).optional()
  }).min(1),

  assignUserRole: customJoi.object({
    role: cleanString(50).required()
  }),

  // ── Branches ──
  createBranch: customJoi.object({
    name: cleanString(100).min(1).required(),
    location: cleanString(200).min(1).required(),
    phone: cleanString(30).allow('', null).optional(),
    manager_id: Joi.number().integer().positive().allow(null).optional(),
    is_active: Joi.number().valid(0, 1).default(1)
  }),

  updateBranch: customJoi.object({
    name: cleanString(100).min(1).optional(),
    location: cleanString(200).min(1).optional(),
    phone: cleanString(30).allow('', null).optional(),
    manager_id: Joi.number().integer().positive().allow(null).optional(),
    is_active: Joi.number().valid(0, 1).optional()
  }).min(1),

  // ── HR ──
  createEmployee: customJoi.object({
    name: cleanString(150).min(1).required(),
    email: customJoi.string().email().max(100).required(),
    phone: cleanString(30).allow('', null).optional(),
    role: cleanString(50).min(1).required(),
    department: cleanString(100).allow('', null).optional(),
    salary: Joi.number().min(0).default(0),
    hourly_rate: Joi.number().min(0).optional(),
    commission_pct: Joi.number().min(0).max(100).optional(),
    statutory_paye_pct: Joi.number().min(0).max(100).optional(),
    statutory_nssf: Joi.number().min(0).optional(),
    statutory_nhif: Joi.number().min(0).optional(),
    benefits_deduction: Joi.number().min(0).optional(),
    branch_id: Joi.number().integer().positive().allow(null).optional(),
    start_date: cleanString(30).allow('', null).optional(),
    hire_date: cleanString(30).allow('', null).optional(),
    national_id: cleanString(50).allow('', null).optional()
  }),

  updateEmployee: customJoi.object({
    name: cleanString(150).min(1).optional(),
    email: customJoi.string().email().max(100).allow('', null).optional(),
    phone: cleanString(30).allow('', null).optional(),
    role: cleanString(50).min(1).optional(),
    department: cleanString(100).allow('', null).optional(),
    salary: Joi.number().min(0).optional(),
    hourly_rate: Joi.number().min(0).optional(),
    commission_pct: Joi.number().min(0).max(100).optional(),
    statutory_paye_pct: Joi.number().min(0).max(100).optional(),
    statutory_nssf: Joi.number().min(0).optional(),
    statutory_nhif: Joi.number().min(0).optional(),
    benefits_deduction: Joi.number().min(0).optional(),
    branch_id: Joi.number().integer().positive().allow(null).optional(),
    status: cleanString(50).valid('active', 'leave', 'terminated').optional()
  }).min(1),

  recordAttendance: customJoi.object({
    employee_id: Joi.number().integer().positive().required(),
    date: cleanString(30).allow('', null).optional(),
    clock_in: cleanString(30).allow('', null).optional(),
    clock_out: cleanString(30).allow('', null).optional(),
    status: cleanString(50).valid('present', 'absent', 'late', 'half_day', 'on_leave').default('present')
  }),

  // ── Procurement ──
  createPurchaseRequest: customJoi.object({
    supplier_id: Joi.number().integer().positive().allow(null).optional(),
    branch_id: Joi.number().integer().positive().allow(null).optional(),
    total_value: Joi.number().min(0).optional(),
    notes: cleanString(500).allow('', null).optional(),
    items: Joi.array().items(
      customJoi.object({
        product_id: Joi.number().integer().positive().optional(),
        item_name: cleanString(200).optional(),
        qty: Joi.number().positive().required(),
        unit_price: Joi.number().min(0).required()
      })
    ).optional()
  }),

  updatePOStatus: customJoi.object({
    status: cleanString(50).valid('pending', 'approved', 'rejected', 'ordered', 'received').required()
  }),

  // ── Accounting ──
  createJournalEntry: customJoi.object({
    type: cleanString(50).valid('revenue', 'expense', 'asset', 'liability').required(),
    category: cleanString(100).allow('', null).optional(),
    description: cleanString(255).min(1).required(),
    amount: Joi.number().positive().required(),
    branch_id: Joi.number().integer().positive().allow(null).optional()
  }),

  // ── Hire Purchase ──
  createHP: customJoi.object({
    customer_name: cleanString(150).min(1).required(),
    customer_phone: cleanString(30).allow('', null).optional(),
    item_name: cleanString(200).min(1).required(),
    total_value: Joi.number().positive().required(),
    down_payment: Joi.number().min(0).required(),
    monthly_instalment: Joi.number().min(0).optional(),
    next_due: cleanString(30).allow('', null).optional(),
    branch_id: Joi.number().integer().positive().allow(null).optional()
  }),

  recordHPPayment: customJoi.object({
    agreement_id: Joi.number().integer().positive().required(),
    amount: Joi.number().positive().required(),
    payment_mode: cleanString(50).allow('', null).optional(),
    receipt_ref: cleanString(100).allow('', null).optional()
  }),

  // ── Receivables ──
  recordARPayment: customJoi.object({
    customer_id: Joi.number().integer().positive().required(),
    amount: Joi.number().positive().required(),
    payment_mode: cleanString(50).allow('', null).optional(),
    notes: cleanString(500).allow('', null).optional()
  }),

  // ── Logistics ──
  createDelivery: customJoi.object({
    destination: cleanString(255).min(1).required(),
    customer_id: Joi.number().integer().positive().allow(null).optional(),
    driver_name: cleanString(100).allow('', null).optional(),
    van_number: cleanString(50).allow('', null).optional(),
    origin: cleanString(200).allow('', null).optional(),
    eta: cleanString(50).allow('', null).optional(),
    branch_id: Joi.number().integer().positive().allow(null).optional()
  }),

  updateDeliveryStatus: customJoi.object({
    status: cleanString(50).valid('pending', 'in_transit', 'delayed', 'delivered', 'cancelled').required(),
    driver_name: cleanString(100).allow('', null).optional(),
    van_number: cleanString(50).allow('', null).optional(),
    eta: cleanString(50).allow('', null).optional()
  }),

  // ── Settings ──
  updateSettings: Joi.object().pattern(
    cleanString(100),
    Joi.alternatives().try(cleanString(5000), Joi.number(), Joi.boolean())
  ).min(1).required(),

  // ── AI ──
  aiChat: customJoi.object({
    message: cleanString(4000).min(1).required(),
    sessionId: cleanString(100).optional(),
    history: Joi.array().optional(),
    branch_id: Joi.alternatives().try(Joi.number(), cleanString(50)).optional()
  })
};

module.exports = {
  Joi: customJoi,
  cleanString,
  rawString,
  validate,
  schemas
};
