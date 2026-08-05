/** MODULE 4: HR Controller — Employees, attendance, payroll summary */

const { getDb, query, exec } = require('../db/database');

async function getEmployees(req, res) {
  try {
    const db = await getDb();
    const { branch_id, status, search } = req.query;
    let sql = `SELECT e.*, b.name AS branch_name FROM employees e
               LEFT JOIN branches b ON e.branch_id = b.id WHERE 1=1`;
    const params = [];
    if (branch_id) { sql += ' AND e.branch_id = ?'; params.push(branch_id); }
    if (status)    { sql += ' AND e.status = ?'; params.push(status); }
    if (search)    { sql += ' AND (e.name LIKE ? OR e.role LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY e.name';
    res.json({ success: true, data: query(db, sql, params) });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function getEmployee(req, res) {
  try {
    const db = await getDb();
    const rows = query(db,
      `SELECT e.*, b.name AS branch_name FROM employees e
       LEFT JOIN branches b ON e.branch_id = b.id WHERE e.id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Employee not found.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function createEmployee(req, res) {
  try {
    const db = await getDb();
    const { name, role, branch_id, salary, phone, email, hire_date } = req.body;
    if (!name || !role) return res.status(400).json({ error: 'name and role are required.' });
    const result = exec(db,
      `INSERT INTO employees (name, role, branch_id, salary, phone, email, hire_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, role, branch_id || null, salary || 0, phone || null, email || null, hire_date || null]);
    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function updateEmployee(req, res) {
  try {
    const db = await getDb();
    const allowed = ['name','role','branch_id','salary','phone','email','hire_date','status','attendance_pct'];
    const fields = req.body;
    const sets = Object.keys(fields).filter(k => allowed.includes(k));
    if (!sets.length) return res.status(400).json({ error: 'No valid fields provided.' });
    const sql = `UPDATE employees SET ${sets.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
    const result = exec(db, sql, [...sets.map(k => fields[k]), req.params.id]);
    if (!result.changes) return res.status(404).json({ error: 'Employee not found.' });
    res.json({ success: true, message: 'Employee updated.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function deleteEmployee(req, res) {
  try {
    const db = await getDb();
    const result = exec(db, "UPDATE employees SET status = 'terminated' WHERE id = ?", [req.params.id]);
    if (!result.changes) return res.status(404).json({ error: 'Employee not found.' });
    res.json({ success: true, message: 'Employee terminated.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function markAttendance(req, res) {
  try {
    const db = await getDb();
    const { employee_id, date, status, notes } = req.body;
    if (!employee_id || !date || !status) {
      return res.status(400).json({ error: 'employee_id, date, status required.' });
    }
    // Upsert attendance
    exec(db,
      `INSERT INTO attendance (employee_id, date, status, notes) VALUES (?, ?, ?, ?)
       ON CONFLICT(employee_id, date) DO UPDATE SET status = excluded.status, notes = excluded.notes`,
      [employee_id, date, status, notes || null]);

    // Recompute attendance_pct for the employee (last 30 days)
    const att = query(db,
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present
       FROM attendance WHERE employee_id = ? AND date >= date('now', '-30 days')`, [employee_id]);
    if (att[0].total > 0) {
      const pct = Math.round((att[0].present / att[0].total) * 100);
      exec(db, 'UPDATE employees SET attendance_pct = ? WHERE id = ?', [pct, employee_id]);
    }
    res.json({ success: true, message: 'Attendance recorded.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function getPayrollSummary(req, res) {
  try {
    const db = await getDb();
    const rows = query(db, `
      SELECT
        COUNT(*) AS total_employees,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present_today,
        SUM(CASE WHEN status = 'on_leave' THEN 1 ELSE 0 END) AS on_leave,
        SUM(CASE WHEN status = 'absent'   THEN 1 ELSE 0 END) AS absent,
        ROUND(SUM(salary), 2) AS total_payroll,
        ROUND(AVG(attendance_pct), 1) AS avg_attendance
      FROM employees WHERE status != 'terminated'
    `);
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

module.exports = { getEmployees, getEmployee, createEmployee, updateEmployee,
                   deleteEmployee, markAttendance, getPayrollSummary };
