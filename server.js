// server.js
const fs = require("fs");
const path = require("path");

const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// Recommended: set ADMIN_PASSWORD in Render env vars instead of hardcoding
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGE_ME_IN_RENDER_ENV";

// ---------- Allow-list (CSV of student numbers only) ----------
const allowedCsvPath = path.join(__dirname, "allowed_students.csv");
function normStudentNo(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, "") // remove spaces inside
    .toUpperCase(); // case-insensitive match
}
function loadAllowedStudentNos() {
  try {
    const raw = fs.readFileSync(allowedCsvPath, "utf8");
    return new Set(
      raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => l.toLowerCase() !== "student_no" && l.toLowerCase() !== "studentno")
        .map((l) => normStudentNo(l.split(",")[0]))
    );
  } catch (e) {
    console.error("Allow-list CSV could not be read:", e.message);
    return new Set();
  }
}

let ALLOWED_STUDENTS = loadAllowedStudentNos();
console.log("Allowed students loaded:", ALLOWED_STUDENTS.size);

// ---------- Middleware ----------
app.use(express.json());

// ---------- Postgres connection (Supabase) ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------- DB init (create + upgrade safely) ----------
(async () => {
  try {
    // Create table if missing (basic structure)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        slot TEXT PRIMARY KEY,
        name TEXT,
        booked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Add new columns if they don't exist (safe for existing DB)
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS student_no TEXT;`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email TEXT;`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS manage_token_hash TEXT;`);
    await pool.query(
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS manage_token_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`
    );

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS bookings_manage_token_hash_unique
      ON bookings (manage_token_hash)
      WHERE manage_token_hash IS NOT NULL;
    `);

    // Ensure one booking per student number
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_per_student_no
      ON bookings (student_no)
      WHERE student_no IS NOT NULL;
    `);

    console.log("DB ready: bookings table ok");
  } catch (err) {
    console.error("DB init failed:", err);
  }
})();

// ---------- API ----------

// Frontend uses this to mark booked slots on load
app.get("/api/bookings", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT slot, booked_at, name, student_no, email FROM bookings");
    const out = {};
    for (const r of rows) {
      out[r.slot] = {
        bookedAt: r.booked_at,
        name: r.name || null,
        studentNo: r.student_no || null,
        email: r.email || null,
      };
    }
    res.json(out);
  } catch (err) {
    console.error("BOOKINGS GET ERROR:", err);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.post("/api/book", async (req, res) => {
  console.log("HIT /api/book", new Date().toISOString());

  const { slot, name, studentNo, email } = req.body || {};

  if (!slot || !name || !studentNo || !email) {
    return res.status(400).json({ ok: false, error: "Missing fields" });
  }

  const sn = normStudentNo(studentNo);
  const nm = String(name).trim();
  const em = String(email).trim().toLowerCase();

  // ✅ Only check student number
  if (!ALLOWED_STUDENTS.has(sn)) {
    return res.status(403).json({ ok: false, error: "Not allowed" });
  }

  // declare outside so catch can reference (if needed)
  let manageToken = null;

  try {
    // Create manage token (store only hash in DB)
    manageToken = crypto.randomBytes(32).toString("hex");
    const manageTokenHash = crypto.createHash("sha256").update(manageToken).digest("hex");

    const q = `
      INSERT INTO bookings (slot, name, student_no, email, manage_token_hash)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (slot) DO NOTHING
      RETURNING slot
    `;

    const result = await pool.query(q, [slot, nm, sn, em, manageTokenHash]);

    if (result.rowCount === 0) {
      return res.status(409).json({ ok: false, error: "Slot already booked" });
    }

    // TEMP (optional): if you want to see token in logs for testing, keep this.
    // Remove later when you email it.
    console.log("MANAGE TOKEN:", manageToken, "slot:", slot, "student:", sn);

    return res.json({ ok: true });
  } catch (err) {
    // one booking per student number
    if (err && err.code === "23505") {
      return res.status(409).json({ ok: false, error: "Already booked once" });
    }

    console.error("BOOK ERROR:", err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Manage lookup by token (used for manage.html later)
// Manage lookup by token
app.get("/api/manage", async (req, res) => {
  const token = String(req.query.token || "").trim();
  if (!token) return res.status(400).json({ ok: false, error: "missing_token" });

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const { rows } = await pool.query(
      `SELECT slot, name, student_no, email, booked_at
       FROM bookings
       WHERE manage_token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    if (!rows.length) return res.status(404).json({ ok: false, error: "not_found" });

    return res.json({ ok: true, booking: rows[0] });
  } catch (err) {
    console.error("MANAGE GET ERROR:", err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Cancel by token
app.post("/api/manage/cancel", async (req, res) => {
  const token = String((req.body && req.body.token) || "").trim();
  if (!token) return res.status(400).json({ ok: false, error: "missing_token" });

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const result = await pool.query(
      `DELETE FROM bookings
       WHERE manage_token_hash = $1
       RETURNING slot`,
      [tokenHash]
    );

    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "not_found" });

    return res.json({ ok: true, cancelledSlot: result.rows[0].slot });
  } catch (err) {
    console.error("MANAGE CANCEL ERROR:", err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.get("/api/appointment/:studentNo", async (req, res) => {
  const sn = normStudentNo(req.params.studentNo);
  if (!sn) return res.status(400).json({ ok: false, error: "missing_studentNo" });

  try {
    const { rows } = await pool.query(
      `SELECT slot, name, student_no, email, booked_at
       FROM bookings
       WHERE UPPER(REGEXP_REPLACE(student_no, '\\s+', '', 'g')) = $1
       ORDER BY booked_at DESC
       LIMIT 1`,
      [sn]
    );

    if (!rows.length) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, booking: rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Backward-compatible: old admin page expects /api/slots
app.get("/api/slots", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT slot, name FROM bookings");
    const out = {};
    for (const r of rows) out[r.slot] = r.name || null;
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Static files
app.use(express.static(path.join(__dirname, "public")));

// Self-ping (Render)
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    fetch(SELF_URL)
      .then(() => console.log("Self ping successful"))
      .catch((err) => console.log("Self ping failed:", err.message));
  }, 4 * 60 * 1000);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});