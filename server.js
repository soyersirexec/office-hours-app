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

// Session cookie signing secret (set ADMIN_SESSION_SECRET in env for stable sessions)
const ADMIN_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET ||
  crypto.createHash("sha256").update(String(ADMIN_PASSWORD)).digest("hex");

const ADMIN_COOKIE_NAME = "admin_session";
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

function base64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64urlDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s + pad, "base64");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) return;
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function signAdminPayload(payloadB64) {
  return crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(payloadB64).digest("hex");
}

function makeAdminCookieValue() {
  const payload = { exp: Date.now() + ADMIN_SESSION_MS };
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const sig = signAdminPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

function verifyAdminCookieValue(value) {
  if (!value || typeof value !== "string") return { ok: false };
  const [payloadB64, sig] = value.split(".");
  if (!payloadB64 || !sig) return { ok: false };
  const expected = signAdminPayload(payloadB64);
  // constant-time compare
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length) return { ok: false };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false };

  try {
    const payload = JSON.parse(base64urlDecode(payloadB64).toString("utf8"));
    if (!payload || typeof payload.exp !== "number") return { ok: false };
    if (Date.now() > payload.exp) return { ok: false, expired: true };
    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  const v = verifyAdminCookieValue(cookies[ADMIN_COOKIE_NAME]);
  if (!v.ok) return res.status(401).json({ ok: false, error: "unauthorized" });
  return next();
}

// ===== Resend email (no SMTP) =====
// Render env vars you must set:
//   RESEND_API_KEY=your_resend_api_key
//   RESEND_FROM="Speaking Center <no-reply@yourdomain.com>"   (must be a verified sender in Resend)
//   PUBLIC_BASE_URL=https://YOUR-RENDER-URL.onrender.com
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

async function sendManageLinkEmail({ to, name, slot, token }) {
  if (!RESEND_API_KEY || !RESEND_FROM) {
    console.log("EMAIL: disabled (missing RESEND_API_KEY or RESEND_FROM)");
    return;
  }
  if (!PUBLIC_BASE_URL) {
    console.log("EMAIL: skipped (missing PUBLIC_BASE_URL env var)");
    return;
  }
  if (!to) return;

  const manageUrl = `${PUBLIC_BASE_URL}/manage.html?token=${encodeURIComponent(token)}`;

  const subject = "Speaking Center Appointment – Manage Link";
  const text =
    `Hello${name ? " " + name : ""},\n\n` +
    `Your appointment has been booked.\n\n` +
    `Slot: ${slot}\n\n` +
    `Manage (cancel/change): ${manageUrl}\n\n`;

  const html =
    `<p>Hello${name ? " " + escapeHtml(name) : ""},</p>` +
    `<p>Your appointment has been booked.</p>` +
    `<p><b>Slot:</b> ${escapeHtml(slot)}</p>` +
    `<p><b>Manage (cancel/change):</b> <a href="${manageUrl}">${manageUrl}</a></p>`;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject,
        html,
        text,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error("EMAIL: Resend failed", resp.status, body);
      return;
    }

    console.log("EMAIL: sent to", to);
  } catch (e) {
    console.error("EMAIL: Resend error:", e);
  }
}
async function sendCancelledEmail({ to, name, oldSlot }) {
  if (!RESEND_API_KEY || !RESEND_FROM) return;
  if (!to) return;

  const subject = "Speaking Center Appointment – Cancelled";
  const text =
    `Hello${name ? " " + name : ""},\n\n` +
    `Your appointment has been cancelled.\n\n` +
    `Slot: ${oldSlot}\n\n`;

  const html =
    `<p>Hello${name ? " " + escapeHtml(name) : ""},</p>` +
    `<p>Your appointment has been cancelled.</p>` +
    `<p><b>Slot:</b> ${escapeHtml(oldSlot)}</p>`;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject,
        html,
        text,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error("EMAIL: cancel failed", resp.status, body);
      return;
    }

    console.log("EMAIL: cancel sent to", to);
  } catch (e) {
    console.error("EMAIL: cancel error:", e);
  }
}

async function sendChangedEmail({ to, name, oldSlot, newSlot }) {
  if (!RESEND_API_KEY || !RESEND_FROM) return;
  if (!to) return;

  const subject = "Speaking Center Appointment – Changed";
  const text =
    `Hello${name ? " " + name : ""},\n\n` +
    `Your appointment has been changed.\n\n` +
    `Old slot: ${oldSlot}\n` +
    `New slot: ${newSlot}\n\n`;

  const html =
    `<p>Hello${name ? " " + escapeHtml(name) : ""},</p>` +
    `<p>Your appointment has been changed.</p>` +
    `<p><b>Old slot:</b> ${escapeHtml(oldSlot)}</p>` +
    `<p><b>New slot:</b> ${escapeHtml(newSlot)}</p>`;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject,
        html,
        text,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error("EMAIL: change failed", resp.status, body);
      return;
    }

    console.log("EMAIL: change sent to", to);
  } catch (e) {
    console.error("EMAIL: change error:", e);
  }
}
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

// no-cache for API responses (prevents weird stale results)
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});

// ---------- Postgres connection (Supabase) ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------- DB init (create + upgrade safely) ----------
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        slot TEXT PRIMARY KEY,
        name TEXT,
        booked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

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

// Public endpoint: return only which slots are booked (no personal data)
app.get("/api/availability", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT slot, booked_at FROM bookings");
    const out = {};
    for (const r of rows) out[r.slot] = { bookedAt: r.booked_at };
    return res.json(out);
  } catch (err) {
    console.error("AVAILABILITY GET ERROR:", err);
    return res.json({});
  }
});

// Admin endpoints (cookie-authenticated)
app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.post("/api/admin/login", async (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const cookieValue = makeAdminCookieValue();
  const isProd = process.env.NODE_ENV === "production";

  res.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
      ADMIN_SESSION_MS / 1000
    )}${isProd ? "; Secure" : ""}`
  );

  return res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  const isProd = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? "; Secure" : ""}`
  );
  return res.json({ ok: true });
});

app.get("/api/admin/bookings", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT slot, booked_at, name, student_no, email FROM bookings ORDER BY slot ASC"
    );
    return res.json({ ok: true, rows });
  } catch (err) {
    console.error("ADMIN BOOKINGS GET ERROR:", err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.delete("/api/admin/cancel/:slot", requireAdmin, async (req, res) => {
  const slot = decodeURIComponent(req.params.slot);
  try {
    const result = await pool.query("DELETE FROM bookings WHERE slot = $1 RETURNING slot", [slot]);
    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, slot: result.rows[0].slot });
  } catch (err) {
    console.error("ADMIN CANCEL ERROR:", err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.post("/api/book", async (req, res) => {
  const { slot, name, studentNo, email } = req.body || {};

  if (!slot || !name || !studentNo || !email) {
    return res.status(400).json({ ok: false, error: "Missing fields" });
  }

  const sn = normStudentNo(studentNo);
  const nm = String(name).trim();
  const em = String(email).trim().toLowerCase();

  if (!ALLOWED_STUDENTS.has(sn)) {
    return res.status(403).json({ ok: false, error: "Not allowed" });
  }

  try {
    const manageToken = crypto.randomBytes(32).toString("hex");
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

    // fire-and-forget email (so UI response isn't delayed)
    sendManageLinkEmail({ to: em, name: nm, slot, token: manageToken }).catch((e) =>
      console.error("EMAIL SEND ERROR:", e)
    );

    return res.json({ ok: true, manageToken });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ ok: false, error: "Already booked once" });
    }
    console.error("BOOK ERROR:", err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});

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

    // get booking first so we can email details
    const cur = await pool.query(
      `SELECT slot, name, email
       FROM bookings
       WHERE manage_token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    if (!cur.rows.length) return res.status(404).json({ ok: false, error: "not_found" });

    const b = cur.rows[0];

    const result = await pool.query(
      `DELETE FROM bookings
       WHERE manage_token_hash = $1
       RETURNING slot`,
      [tokenHash]
    );

    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "not_found" });

    // fire-and-forget email
    sendCancelledEmail({ to: b.email, name: b.name, oldSlot: b.slot }).catch((e) =>
      console.error("EMAIL CANCEL ERROR:", e)
    );

    return res.json({ ok: true, cancelledSlot: result.rows[0].slot });
  } catch (err) {
    console.error("MANAGE CANCEL ERROR:", err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Change by token (handles one-booking-per-student unique index safely)
app.post("/api/manage/change", async (req, res) => {
  const token = String((req.body && req.body.token) || "").trim();
  const newSlot = String((req.body && req.body.newSlot) || "").trim();

  if (!token) return res.status(400).json({ ok: false, error: "missing_token" });
  if (!newSlot) return res.status(400).json({ ok: false, error: "missing_newSlot" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const cur = await client.query(
      `SELECT slot, name, student_no, email
       FROM bookings
       WHERE manage_token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    if (!cur.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const current = cur.rows[0];

    if (current.slot === newSlot) {
      await client.query("ROLLBACK");
      return res.json({ ok: true, oldSlot: current.slot, newSlot });
    }

    const taken = await client.query(`SELECT 1 FROM bookings WHERE slot = $1 LIMIT 1`, [newSlot]);
    if (taken.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "slot_taken" });
    }

    await client.query(`DELETE FROM bookings WHERE manage_token_hash = $1`, [tokenHash]);

    await client.query(
      `INSERT INTO bookings (slot, name, student_no, email, manage_token_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [newSlot, current.name, current.student_no, current.email, tokenHash]
    );

    await client.query("COMMIT");
    sendChangedEmail({
  to: current.email,
  name: current.name,
  oldSlot: current.slot,
  newSlot,
}).catch((e) => console.error("EMAIL CHANGE ERROR:", e));
    return res.json({ ok: true, oldSlot: current.slot, newSlot });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("MANAGE CHANGE ERROR:", err);

    if (err && err.code === "23505") {
      return res.status(409).json({ ok: false, error: "conflict" });
    }

    return res.status(500).json({ ok: false, error: "db_error" });
  } finally {
    client.release();
  }
});

// Optional: Admin cancel booking (password protected)
app.delete("/api/cancel/:slot", requireAdmin, async (req, res) => {
  const slot = decodeURIComponent(req.params.slot);
  try {
    const result = await pool.query("DELETE FROM bookings WHERE slot = $1 RETURNING slot", [slot]);
    if (result.rowCount === 0) return res.status(404).json({ message: "not_found" });
    res.json({ message: "Booking cancelled", slot: result.rows[0].slot });
  } catch (err) {
    console.error("ADMIN CANCEL ERROR:", err);
    res.status(500).json({ message: "db_error" });
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
    console.error("APPOINTMENT GET ERROR:", err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Backward-compatible: old admin page expects /api/slots
app.get("/api/slots", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT slot, name FROM bookings");
    const out = {};
    for (const r of rows) out[r.slot] = r.name || null;
    return res.json(out);
  } catch (err) {
    console.error("SLOTS GET ERROR:", err);
    return res.json({});
  }
});

// All slots (source of truth)
app.get("/api/all-slots", (req, res) => {
  const ALL_SLOTS = [
    "2026-03-02-09-00","2026-03-02-10-00","2026-03-02-10-45","2026-03-02-11-15","2026-03-02-12-00","2026-03-02-13-15","2026-03-02-13-45","2026-03-02-14-30",
    "2026-03-03-09-00","2026-03-03-10-00","2026-03-03-10-45","2026-03-03-11-15","2026-03-03-12-00","2026-03-03-13-15","2026-03-03-13-45","2026-03-03-14-30",
    "2026-03-09-09-00","2026-03-09-10-00","2026-03-09-10-45","2026-03-09-11-15","2026-03-09-12-00","2026-03-09-13-15","2026-03-09-13-45","2026-03-09-14-30",
    "2026-03-10-09-00","2026-03-10-10-00","2026-03-10-10-45","2026-03-10-11-15","2026-03-10-12-00","2026-03-10-13-15","2026-03-10-13-45","2026-03-10-14-30",
    "2026-03-16-09-00","2026-03-16-10-00","2026-03-16-10-45","2026-03-16-11-15","2026-03-16-12-00","2026-03-16-13-15","2026-03-16-13-45","2026-03-16-14-30",
    "2026-03-17-09-00","2026-03-17-10-00","2026-03-17-10-45","2026-03-17-11-15","2026-03-17-12-00","2026-03-17-13-15","2026-03-17-13-45","2026-03-17-14-30",
    "2026-03-23-09-00","2026-03-23-10-00","2026-03-23-10-45","2026-03-23-11-15","2026-03-23-12-00","2026-03-23-13-15","2026-03-23-13-45","2026-03-23-14-30",
    "2026-03-24-09-00","2026-03-24-10-00","2026-03-24-10-45","2026-03-24-11-15","2026-03-24-12-00","2026-03-24-13-15","2026-03-24-13-45","2026-03-24-14-30",
    "2026-03-30-09-00","2026-03-30-10-00","2026-03-30-10-45","2026-03-30-11-15","2026-03-30-12-00","2026-03-30-13-15","2026-03-30-13-45","2026-03-30-14-30",
    "2026-03-31-09-00","2026-03-31-10-00","2026-03-31-10-45","2026-03-31-11-15","2026-03-31-12-00","2026-03-31-13-15","2026-03-31-13-45","2026-03-31-14-30",
    "2026-04-06-09-00","2026-04-06-10-00","2026-04-06-10-45","2026-04-06-11-15","2026-04-06-12-00","2026-04-06-13-15","2026-04-06-13-45","2026-04-06-14-30",
    "2026-04-07-09-00","2026-04-07-10-00","2026-04-07-10-45","2026-04-07-11-15","2026-04-07-12-00","2026-04-07-13-15","2026-04-07-13-45","2026-04-07-14-30",
    "2026-04-27-09-00","2026-04-27-10-00","2026-04-27-10-45","2026-04-27-11-15","2026-04-27-12-00","2026-04-27-13-15","2026-04-27-13-45","2026-04-27-14-30",
    "2026-04-28-09-00","2026-04-28-10-00","2026-04-28-10-45","2026-04-28-11-15","2026-04-28-12-00","2026-04-28-13-15","2026-04-28-13-45","2026-04-28-14-30",
    "2026-05-04-09-00","2026-05-04-10-00","2026-05-04-10-45","2026-05-04-11-15","2026-05-04-12-00","2026-05-04-13-15","2026-05-04-13-45","2026-05-04-14-30",
    "2026-05-05-09-00","2026-05-05-10-00","2026-05-05-10-45","2026-05-05-11-15","2026-05-05-12-00","2026-05-05-13-15","2026-05-05-13-45","2026-05-05-14-30",
    "2026-05-11-09-00","2026-05-11-10-00","2026-05-11-10-45","2026-05-11-11-15","2026-05-11-12-00","2026-05-11-13-15","2026-05-11-13-45","2026-05-11-14-30",
    "2026-05-12-09-00","2026-05-12-10-00","2026-05-12-10-45","2026-05-12-11-15","2026-05-12-12-00","2026-05-12-13-15","2026-05-12-13-45","2026-05-12-14-30",
    "2026-05-18-09-00","2026-05-18-10-00","2026-05-18-10-45","2026-05-18-11-15","2026-05-18-12-00","2026-05-18-13-15","2026-05-18-13-45","2026-05-18-14-30",
    "2026-05-19-09-00","2026-05-19-10-00","2026-05-19-10-45","2026-05-19-11-15","2026-05-19-12-00","2026-05-19-13-15","2026-05-19-13-45","2026-05-19-14-30",
    "2026-05-25-09-00","2026-05-25-10-00","2026-05-25-10-45","2026-05-25-11-15","2026-05-25-12-00","2026-05-25-13-15","2026-05-25-13-45","2026-05-25-14-30",
    "2026-05-26-09-00","2026-05-26-10-00","2026-05-26-10-45","2026-05-26-11-15","2026-05-26-12-00","2026-05-26-13-15","2026-05-26-13-45","2026-05-26-14-30",
    "2026-06-01-09-00","2026-06-01-10-00","2026-06-01-10-45","2026-06-01-11-15","2026-06-01-12-00","2026-06-01-13-15","2026-06-01-13-45","2026-06-01-14-30",
    "2026-06-02-09-00","2026-06-02-10-00","2026-06-02-10-45","2026-06-02-11-15","2026-06-02-12-00","2026-06-02-13-15","2026-06-02-13-45","2026-06-02-14-30",
  ];

  return res.json(ALL_SLOTS);
});
const path = require("path");

// middleware to check admin session
function requireAdmin(req, res, next) {
  if (req.cookies && req.cookies.admin_session) {
    try {
      const decoded = jwt.verify(req.cookies.admin_session, ADMIN_SESSION_SECRET);
      if (decoded && decoded.role === "admin") {
        return next();
      }
    } catch (err) {}
  }
  return res.redirect("/admin-login");
}

// serve login page (public)
app.get("/admin-login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.secure.html"));
});

// serve admin panel (protected)
app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "private", "admin.html"));
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