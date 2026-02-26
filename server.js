// server.js
const fs = require("fs");
const path = require("path");

const allowedCsvPath = path.join(__dirname, "allowed_students.csv");

function loadAllowedStudentNos() {
  try {
    const raw = fs.readFileSync(allowedCsvPath, "utf8");

    return new Set(
      raw
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .filter(l => l.toLowerCase() !== "student_no") // ignore header if present
        .map(l => l.split(",")[0].trim()) // take first column only
    );
  } catch {
    return new Set();
  }
}

let ALLOWED_STUDENTS = loadAllowedStudentNos();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Www1903121912-";

app.use(express.json());

// ---- Postgres connection (Supabase) ----
// IMPORTANT: On Supabase/Render you usually need SSL.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Create bookings table if it doesn't exist (schema matches API)
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        slot TEXT PRIMARY KEY,
        name TEXT,
        booked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log("DB ready: bookings table ok");
  } catch (err) {
    console.error("DB init failed:", err);
  }
})();

// ---- API ----

// Frontend uses this to mark booked slots on load
app.get("/api/bookings", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT slot, booked_at, name FROM bookings");
    const out = {};
    for (const r of rows) out[r.slot] = { bookedAt: r.booked_at, name: r.name || null };
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.post("/api/book", async (req, res) => {
  const { slot, name, studentNo, email } = req.body || {};

  if (!slot || !name || !studentNo || !email) {
    return res.status(400).json({ ok: false, error: "Missing fields" });
  }

  const sn = String(studentNo).trim();
  const nm = String(name).trim();
  const em = String(email).trim().toLowerCase();

  // ✅ Only check student number
  if (!ALLOWED_STUDENTS.has(sn)) {
    return res.status(403).json({ ok: false, error: "Not allowed" });
  }

  try {
    const q = `
      INSERT INTO bookings (slot, name, student_no, email)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (slot) DO NOTHING
      RETURNING slot
    `;

    const result = await pool.query(q, [slot, nm, sn, em]);

    if (result.rowCount === 0) {
      return res.status(409).json({ ok: false, error: "Slot already booked" });
    }

    return res.json({ ok: true });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ ok: false, error: "Already booked once" });
    }

    console.error(err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Serve static files EXCEPT admin.html
app.use((req, res, next) => {
  if (req.path === "/admin.html") return next();
  express.static(path.join(__dirname, "public"))(req, res, next);
});
// Optional: Admin cancel booking (password protected)
app.delete("/api/cancel/:slot", async (req, res) => {
  const pw = req.query.pw;
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ message: "Unauthorized" });

  const slot = req.params.slot;
  try {
    await pool.query("DELETE FROM bookings WHERE slot = $1", [slot]);
    res.json({ message: "Booking cancelled" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "db_error" });
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