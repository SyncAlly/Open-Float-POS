/** MODULE 4: HR Controller — Employees, Clock-In/Out, Payroll Calculation */

const { getDb, query, exec } = require('../db/database');

// ─────────────── EMPLOYEES ───────────────

async function getEmployees(req, res) {
  try {
    const db = await getDb();
    const { branch_id, status, search } = req.query;
    let sql = `SELECT e.*, b.name AS branch_name FROM employees e LEFT JOIN branches b ON e.branch_id = b.id WHERE 1=1`;
    const params = [];
    if (branch_id) { sql += ' AND e.branch_id = ?'; params.push(branch_id); }
    if (status)    { sql += ' AND e.status = ?'; params.push(status); }
    if (search)    { sql += ' AND (e.name LIKE ? OR e.role LIKE ?)'; params.push('%' + search + '%', '%' + search + '%'); }
    sql += ' ORDER BY e.name';
    res.json({ success: true, data: query(db, sql, params) });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function getEmployee(req, res) {
  try {
    const db = await getDb();
    const rows = query(db, `SELECT e.*, b.name AS branch_name FROM employees e LEFT JOIN branches b ON e.branch_id = b.id WHERE e.id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Employee not found.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function createEmployee(req, res) {
  try {
    const db = await getDb();
    const { name, role, branch_id, salary, hourly_rate, commission_pct, statutory_paye_pct, statutory_nssf, statutory_nhif, benefits_deduction, phone, email, hire_date } = req.body;
    if (!name || !role) return res.status(400).json({ error: 'name and role are required.' });
    const result = exec(db,
      `INSERT INTO employees (name, role, branch_id, salary, hourly_rate, commission_pct, statutory_paye_pct, statutory_nssf, statutory_nhif, benefits_deduction, phone, email, hire_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, role, branch_id || null, salary || 0, hourly_rate !== undefined ? hourly_rate : 250, commission_pct !== undefined ? commission_pct : 0, statutory_paye_pct !== undefined ? statutory_paye_pct : 10, statutory_nssf !== undefined ? statutory_nssf : 1080, statutory_nhif !== undefined ? statutory_nhif : 1700, benefits_deduction !== undefined ? benefits_deduction : 0, phone || null, email || null, hire_date || null]);
    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function updateEmployee(req, res) {
  try {
    const db = await getDb();
    const existing = query(db, 'SELECT * FROM employees WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Employee not found.' });
    const oldEmp = existing[0];
    const allowed = ['name','role','branch_id','salary','hourly_rate','commission_pct','statutory_paye_pct','statutory_nssf','statutory_nhif','benefits_deduction','phone','email','hire_date','status','attendance_pct'];
    const fields = req.body;
    const sets = Object.keys(fields).filter(k => allowed.includes(k));
    if (!sets.length) return res.status(400).json({ error: 'No valid fields provided.' });
    const sql = `UPDATE employees SET ${sets.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
    const result = exec(db, sql, [...sets.map(k => fields[k]), req.params.id]);
    if (!result.changes) return res.status(404).json({ error: 'Employee not found.' });

    const empEmail = (fields.email !== undefined ? fields.email : oldEmp.email || '').toLowerCase();
    const oldEmail = (oldEmp.email || '').toLowerCase();
    if (empEmail || oldEmail) {
      const uSets = []; const uParams = [];
      if (fields.branch_id !== undefined) { uSets.push('branch_id = ?'); uParams.push(fields.branch_id); }
      if (fields.name !== undefined)      { uSets.push('name = ?');      uParams.push(fields.name); }
      if (fields.role !== undefined)      { uSets.push('role = ?');      uParams.push(fields.role); }
      if (fields.email !== undefined)     { uSets.push('email = ?');     uParams.push(fields.email.toLowerCase()); }
      if (uSets.length > 0) {
        uParams.push(oldEmail || empEmail, empEmail || oldEmail);
        exec(db, `UPDATE users SET ${uSets.join(', ')} WHERE LOWER(email) = ? OR LOWER(email) = ?`, uParams);
      }
    }
    res.json({ success: true, message: 'Employee updated.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function deleteEmployee(req, res) {
  try {
    const db = await getDb();
    const existing = query(db, 'SELECT email FROM employees WHERE id = ?', [req.params.id]);
    if (existing.length && existing[0].email) {
      exec(db, 'UPDATE users SET is_active = 0 WHERE LOWER(email) = ? AND role != "owner"', [existing[0].email.toLowerCase()]);
    }
    exec(db, 'DELETE FROM time_entries WHERE employee_id = ?', [req.params.id]);
    exec(db, 'DELETE FROM payroll_records WHERE employee_id = ?', [req.params.id]);
    const result = exec(db, 'DELETE FROM employees WHERE id = ?', [req.params.id]);
    if (!result.changes) return res.status(404).json({ error: 'Employee not found.' });
    res.json({ success: true, message: 'Employee and login credentials removed.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// ─────────────── HELPER: PAYROLL & SHIFT RULES ───────────────

function getPayrollRules(db) {
  const rows = query(db, 'SELECT key, value FROM settings WHERE key LIKE "payroll_%"');
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return {
    ot_threshold_hours: parseFloat(s.payroll_ot_threshold_hours) || 8,
    ot_multiplier: parseFloat(s.payroll_ot_multiplier) || 1.5,
    diff_evening_pct: s.payroll_diff_evening_pct !== undefined ? parseFloat(s.payroll_diff_evening_pct) : 10,
    diff_night_pct: s.payroll_diff_night_pct !== undefined ? parseFloat(s.payroll_diff_night_pct) : 30,
    diff_weekend_pct: s.payroll_diff_weekend_pct !== undefined ? parseFloat(s.payroll_diff_weekend_pct) : 25
  };
}

// ─────────────── CLOCK-IN / CLOCK-OUT ───────────────

async function clockIn(req, res) {
  try {
    const db = await getDb();
    const { employee_id, branch_id } = req.body;
    if (!employee_id || !branch_id) return res.status(400).json({ error: 'employee_id and branch_id are required.' });
    const existing = query(db, `SELECT id FROM time_entries WHERE employee_id = ? AND status = 'open'`, [employee_id]);
    if (existing.length) return res.status(409).json({ error: 'Already clocked in. Clock out first.' });

    const rules = getPayrollRules(db);
    const now = new Date(); const hour = now.getHours(); const day = now.getDay();
    let shiftType = 'day', differentialPct = 0;
    if (day === 0 || day === 6) {
      shiftType = 'weekend';
      differentialPct = rules.diff_weekend_pct;
    } else if (hour >= 22 || hour < 6) {
      shiftType = 'night';
      differentialPct = rules.diff_night_pct;
    } else if (hour >= 18) {
      shiftType = 'evening';
      differentialPct = rules.diff_evening_pct;
    }

    const emp = query(db, 'SELECT hourly_rate FROM employees WHERE id = ?', [employee_id]);
    const hourlyRate = emp[0]?.hourly_rate || 250;
    exec(db,
      `INSERT INTO time_entries (employee_id, branch_id, clock_in, hourly_rate, shift_type, differential_pct)
       VALUES (?, ?, datetime('now','localtime'), ?, ?, ?)`,
      [employee_id, branch_id, hourlyRate, shiftType, differentialPct]);
    res.json({ success: true, message: 'Clocked in.', shift_type: shiftType, differential_pct: differentialPct });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function clockOut(req, res) {
  try {
    const db = await getDb();
    const { employee_id, shortage_amount } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'employee_id is required.' });

    const openShift = query(db, `SELECT * FROM time_entries WHERE employee_id = ? AND status = 'open'`, [employee_id]);
    if (!openShift.length) return res.status(404).json({ error: 'No open shift found.' });
    const shift = openShift[0];

    const rules = getPayrollRules(db);
    const totalHours = (new Date() - new Date(shift.clock_in)) / (1000 * 60 * 60);
    const regularHours = Math.min(totalHours, rules.ot_threshold_hours);
    const overtimeHours = Math.max(0, totalHours - rules.ot_threshold_hours);
    exec(db,
      `UPDATE time_entries SET clock_out = datetime('now','localtime'), regular_hours = ?, overtime_hours = ?, status = 'closed' WHERE id = ?`,
      [parseFloat(regularHours.toFixed(2)), parseFloat(overtimeHours.toFixed(2)), shift.id]);

    const shortage = parseFloat(shortage_amount || 0);
    const diff = 1 + (shift.differential_pct || 0) / 100;
    const regularPay = regularHours * (shift.hourly_rate || 250) * diff;
    const overtimePay = overtimeHours * (shift.hourly_rate || 250) * rules.ot_multiplier * diff;
    const gross = regularPay + overtimePay;

    const emp = query(db, 'SELECT * FROM employees WHERE id = ?', [employee_id]);
    const e = emp[0] || {};
    const payePct = (e.statutory_paye_pct || 10) / 100;
    const nssf = e.statutory_nssf || 1080;
    const nhif = e.statutory_nhif || 1700;
    const benefits = e.benefits_deduction || 0;
    const taxPaye = gross * payePct;
    const totalDed = taxPaye + nssf + nhif + benefits + shortage;
    const net = Math.max(0, gross - totalDed);

    const today = new Date().toISOString().split('T')[0];
    exec(db,
      `INSERT INTO payroll_records (employee_id, branch_id, period_start, period_end, regular_pay, overtime_pay, gross_earnings, tax_paye, statutory_nssf, statutory_nhif, shortage_deduction, benefits_deduction, total_deductions, net_pay)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [employee_id, shift.branch_id, today, today, parseFloat(regularPay.toFixed(2)), parseFloat(overtimePay.toFixed(2)), parseFloat(gross.toFixed(2)), parseFloat(taxPaye.toFixed(2)), nssf, nhif, shortage, benefits, parseFloat(totalDed.toFixed(2)), parseFloat(net.toFixed(2))]);

    res.json({
      success: true,
      message: 'Clocked out.',
      summary: {
        regular_hours: parseFloat(regularHours.toFixed(2)),
        overtime_hours: parseFloat(overtimeHours.toFixed(2)),
        gross_earnings: parseFloat(gross.toFixed(2)),
        total_deductions: parseFloat(totalDed.toFixed(2)),
        net_pay: parseFloat(net.toFixed(2))
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function getShiftStatus(req, res) {
  try {
    const db = await getDb();
    const { employee_id } = req.query;
    if (!employee_id) return res.status(400).json({ error: 'employee_id required.' });
    const open = query(db, `SELECT *, strftime('%H:%M', clock_in) AS clock_in_time FROM time_entries WHERE employee_id = ? AND status = 'open'`, [employee_id]);
    const todayHours = query(db, `SELECT COALESCE(SUM(regular_hours + overtime_hours), 0) AS hours_today FROM time_entries WHERE employee_id = ? AND date(clock_in,'localtime') = date('now','localtime') AND status = 'closed'`, [employee_id]);
    res.json({
      success: true,
      clocked_in: open.length > 0,
      shift: open[0] || null,
      hours_today: parseFloat((todayHours[0]?.hours_today || 0).toFixed(2))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// ─────────────── PAYROLL CALCULATION ───────────────

async function calculatePayroll(req, res) {
  try {
    const db = await getDb();
    const { employee_id, period_start, period_end } = req.query;
    if (!employee_id || !period_start || !period_end) {
      return res.status(400).json({ error: 'employee_id, period_start, period_end required.' });
    }
    const emp = query(db, `SELECT e.*, b.name AS branch_name FROM employees e LEFT JOIN branches b ON e.branch_id = b.id WHERE e.id = ?`, [employee_id]);
    if (!emp.length) return res.status(404).json({ error: 'Employee not found.' });
    const e = emp[0];

    const timeData = query(db,
      `SELECT COALESCE(SUM(regular_hours), 0) AS reg, COALESCE(SUM(overtime_hours), 0) AS ot
       FROM time_entries WHERE employee_id = ? AND date(clock_in,'localtime') >= ? AND date(clock_in,'localtime') <= ? AND status = 'closed'`,
      [employee_id, period_start, period_end]);

    const salesData = query(db,
      `SELECT COALESCE(SUM(total), 0) AS sales_total FROM transactions
       WHERE (cashier_id = ? OR cashier_id IN (SELECT u.id FROM users u WHERE LOWER(u.email) = LOWER(?) OR u.name = ?))
         AND date(created_at,'localtime') >= ? AND date(created_at,'localtime') <= ? AND status != 'void'`,
      [employee_id, e.email || '', e.name, period_start, period_end]);

    const shortageData = query(db,
      `SELECT COALESCE(SUM(shortage_deduction), 0) AS total_shortage FROM payroll_records
       WHERE employee_id = ? AND period_start >= ? AND period_end <= ?`,
      [employee_id, period_start, period_end]);

    const rules = getPayrollRules(db);
    const td = timeData[0] || {};
    const regH = parseFloat(td.reg || 0);
    const otH = parseFloat(td.ot || 0);
    const hr = e.hourly_rate || 250;
    const regPay = regH * hr;
    const otPay = otH * hr * rules.ot_multiplier;
    const sales = parseFloat(salesData[0]?.sales_total || 0);
    const comm = sales * ((e.commission_pct || 0) / 100);
    const gross = regPay + otPay + comm;

    const payePct = (e.statutory_paye_pct || 10) / 100;
    const nssf = e.statutory_nssf || 1080;
    const nhif = e.statutory_nhif || 1700;
    const ben = e.benefits_deduction || 0;
    const short = parseFloat(shortageData[0]?.total_shortage || 0);
    const taxPaye = gross * payePct;
    const totalDed = taxPaye + nssf + nhif + ben + short;
    const net = Math.max(0, gross - totalDed);

    res.json({
      success: true,
      data: {
        employee: { id: e.id, name: e.name, role: e.role, branch: e.branch_name },
        period: { start: period_start, end: period_end },
        earnings: {
          regular_hours: parseFloat(regH.toFixed(2)),
          overtime_hours: parseFloat(otH.toFixed(2)),
          regular_pay: parseFloat(regPay.toFixed(2)),
          overtime_pay: parseFloat(otPay.toFixed(2)),
          commission_pay: parseFloat(comm.toFixed(2)),
          sales_total: parseFloat(sales.toFixed(2)),
          gross_earnings: parseFloat(gross.toFixed(2))
        },
        deductions: {
          tax_paye: parseFloat(taxPaye.toFixed(2)),
          statutory_nssf: nssf,
          statutory_nhif: nhif,
          benefits_deduction: ben,
          shortage_deduction: parseFloat(short.toFixed(2)),
          total_deductions: parseFloat(totalDed.toFixed(2))
        },
        net_pay: parseFloat(net.toFixed(2))
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// ─────────────── LABOR ANALYTICS ───────────────

async function getLaborAnalytics(req, res) {
  try {
    const db = await getDb();
    const { branch_id, period } = req.query;
    let dateFilter;
    if (period === 'today')       dateFilter = "date('now','localtime')";
    else if (period === 'week')   dateFilter = "date('now','localtime','-6 days')";
    else if (period === 'month')  dateFilter = "date('now','localtime','start of month')";
    else                          dateFilter = "date('now','localtime','start of year')";

    const bFilter   = (branch_id && branch_id !== 'all') ? 'AND te.branch_id = ?' : '';
    const txBFilter = (branch_id && branch_id !== 'all') ? 'AND t.branch_id = ?' : '';
    const bParam    = (branch_id && branch_id !== 'all') ? [branch_id] : [];

    const periodCond   = period === 'today'
      ? `date(te.clock_in,'localtime') = date('now','localtime')`
      : `date(te.clock_in,'localtime') >= ${dateFilter}`;
    const txPeriodCond = period === 'today'
      ? `date(t.created_at,'localtime') = date('now','localtime')`
      : `date(t.created_at,'localtime') >= ${dateFilter}`;

    const rules = getPayrollRules(db);
    const otMult = rules.ot_multiplier;

    const laborData = query(db,
      `SELECT
         COALESCE(SUM(te.regular_hours * te.hourly_rate * (1 + te.differential_pct/100.0)), 0) AS reg_lab,
         COALESCE(SUM(te.overtime_hours * te.hourly_rate * ${otMult} * (1 + te.differential_pct/100.0)), 0) AS ot_lab,
         COALESCE(SUM(te.regular_hours + te.overtime_hours), 0) AS total_hours,
         COUNT(DISTINCT te.employee_id) AS active_staff
       FROM time_entries te WHERE ${periodCond} ${bFilter}`,
      bParam);

    const salesData = query(db,
      `SELECT COALESCE(SUM(t.total), 0) AS gross_sales FROM transactions t
       WHERE ${txPeriodCond} ${txBFilter} AND t.status != 'void'`,
      bParam);

    const liveData = query(db,
      `SELECT COUNT(*) AS live_shifts FROM time_entries WHERE status = 'open' ${bFilter.replace('te.', '')}`,
      bParam);

    const branchBreakdown = query(db,
      `SELECT b.name AS branch_name,
              COALESCE(SUM(te.regular_hours + te.overtime_hours), 0) AS hours,
              COALESCE(SUM(te.regular_hours * te.hourly_rate * (1 + te.differential_pct/100.0) +
                           te.overtime_hours * te.hourly_rate * ${otMult} * (1 + te.differential_pct/100.0)), 0) AS labor_cost
       FROM time_entries te LEFT JOIN branches b ON te.branch_id = b.id
       WHERE ${periodCond}
       GROUP BY te.branch_id ORDER BY labor_cost DESC`,
      []);

    const ld = laborData[0] || {};
    const totalLC = parseFloat(((ld.reg_lab || 0) + (ld.ot_lab || 0)).toFixed(2));
    const gs = parseFloat((salesData[0]?.gross_sales || 0).toFixed(2));
    const ratio = gs > 0 ? parseFloat(((totalLC / gs) * 100).toFixed(1)) : 0;

    res.json({
      success: true,
      data: {
        period,
        total_labor_cost: totalLC,
        total_hours: parseFloat((ld.total_hours || 0).toFixed(2)),
        active_staff: ld.active_staff || 0,
        live_shifts: liveData[0]?.live_shifts || 0,
        gross_sales: gs,
        labor_ratio_pct: ratio,
        labor_status: ratio === 0 ? 'no_data' : ratio < 18 ? 'healthy' : ratio < 25 ? 'monitor' : 'critical',
        branch_breakdown: branchBreakdown
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// ─────────────── PAYROLL EXPORT ───────────────

async function exportPayroll(req, res) {
  try {
    const db = await getDb();
    const { branch_id, period_start, period_end } = req.query;
    if (!period_start || !period_end) return res.status(400).json({ error: 'period_start and period_end required.' });

    const bFilter = (branch_id && branch_id !== 'all') ? 'AND e.branch_id = ?' : '';
    const bParam  = (branch_id && branch_id !== 'all') ? [branch_id] : [];
    const employees = query(db, `SELECT e.* FROM employees e WHERE e.status != 'terminated' ${bFilter} ORDER BY e.name`, bParam);
    const rules = getPayrollRules(db);

    const rows = [];
    for (const e of employees) {
      const td = (query(db,
        `SELECT COALESCE(SUM(regular_hours), 0) AS reg, COALESCE(SUM(overtime_hours), 0) AS ot
         FROM time_entries WHERE employee_id = ? AND date(clock_in,'localtime') >= ? AND date(clock_in,'localtime') <= ? AND status = 'closed'`,
        [e.id, period_start, period_end])[0] || {});

      const sales = parseFloat((query(db,
        `SELECT COALESCE(SUM(total), 0) AS s FROM transactions
         WHERE (cashier_id = ? OR cashier_id IN (SELECT u.id FROM users u WHERE LOWER(u.email) = LOWER(?) OR u.name = ?))
           AND date(created_at,'localtime') >= ? AND date(created_at,'localtime') <= ? AND status != 'void'`,
        [e.id, e.email || '', e.name, period_start, period_end])[0]?.s || 0));

      const short = parseFloat((query(db,
        `SELECT COALESCE(SUM(shortage_deduction), 0) AS sh FROM payroll_records
         WHERE employee_id = ? AND period_start >= ? AND period_end <= ?`,
        [e.id, period_start, period_end])[0]?.sh || 0));

      const regH = parseFloat(td.reg || 0);
      const otH = parseFloat(td.ot || 0);
      const hr = e.hourly_rate || 250;
      const regPay = regH * hr;
      const otPay = otH * hr * rules.ot_multiplier;
      const comm = sales * ((e.commission_pct || 0) / 100);
      const gross = regPay + otPay + comm;
      const paye = gross * ((e.statutory_paye_pct || 10) / 100);
      const nssf = e.statutory_nssf || 1080;
      const nhif = e.statutory_nhif || 1700;
      const ben = e.benefits_deduction || 0;
      const totalDed = paye + nssf + nhif + ben + short;
      const net = Math.max(0, gross - totalDed);

      rows.push({
        employee_name: e.name,
        role: e.role,
        email: e.email || '',
        regular_hours: regH.toFixed(2),
        overtime_hours: otH.toFixed(2),
        regular_pay: regPay.toFixed(2),
        overtime_pay: otPay.toFixed(2),
        commission_pay: comm.toFixed(2),
        gross_earnings: gross.toFixed(2),
        tax_paye: paye.toFixed(2),
        statutory_nssf: nssf,
        statutory_nhif: nhif,
        benefits_deduction: ben,
        shortage_deduction: short.toFixed(2),
        total_deductions: totalDed.toFixed(2),
        net_pay: net.toFixed(2)
      });
    }
    res.json({ success: true, period: { start: period_start, end: period_end }, data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// ─────────────── PAYROLL SUMMARY (KPI data) ───────────────

async function getPayrollSummary(req, res) {
  try {
    const db = await getDb();
    const { branch_id } = req.query;
    const bF = branch_id && branch_id !== 'all' ? 'AND branch_id = ?' : '';
    const bP = branch_id && branch_id !== 'all' ? [branch_id] : [];

    const overall = query(db, `
      SELECT
        (SELECT COUNT(*) FROM employees WHERE status != 'terminated' ${bF}) AS total_employees,
        (SELECT COUNT(*) FROM time_entries WHERE status = 'open'
          AND employee_id IN (SELECT id FROM employees WHERE 1=1 ${bF})) AS clocked_in_now,
        (SELECT COUNT(*) FROM time_entries WHERE date(clock_in,'localtime') = date('now','localtime')
          AND employee_id IN (SELECT id FROM employees WHERE 1=1 ${bF})) AS shifts_today,
        (SELECT COALESCE(SUM(salary), 0) FROM employees WHERE status != 'terminated' ${bF}) AS total_payroll,
        (SELECT COALESCE(ROUND(AVG(attendance_pct), 1), 100) FROM employees WHERE status != 'terminated' ${bF}) AS avg_attendance
    `, [...bP, ...bP, ...bP, ...bP, ...bP]);

    const history = query(db, `
      SELECT date(clock_in,'localtime') AS date,
             COUNT(DISTINCT employee_id) AS present,
             COALESCE(SUM(regular_hours + overtime_hours), 0) AS hours
      FROM time_entries
      WHERE date(clock_in,'localtime') >= date('now', '-14 days')
        AND employee_id IN (SELECT id FROM employees WHERE 1=1 ${bF})
      GROUP BY date(clock_in,'localtime')
      ORDER BY date ASC
    `, bP);

    res.json({ success: true, data: overall[0] || {}, history: history || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

module.exports = {
  getEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee,
  clockIn, clockOut, getShiftStatus, calculatePayroll, getLaborAnalytics,
  exportPayroll, getPayrollSummary
};

