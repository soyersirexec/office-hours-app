// server.js
const fs = require("fs");
const path = require("path");

function readSlotsFromIndexHtml() {
  // Try common locations (repo root and /public)
  const candidates = [
    path.join(__dirname, "index.html"),
    path.join(__dirname, "public", "index.html"),
  ];

  const htmlPath = candidates.find((p) => fs.existsSync(p));
  if (!htmlPath) {
    console.error("ALL-SLOTS: index.html not found in", candidates);
    return [];
  }

  const html = fs.readFileSync(htmlPath, "utf8");
  // Extract values like: data-slot="2026-03-02-09-30"
  const reSlot = /data-slot="([^"]+)"/g;
  const slots = new Set();
  let m;
  while ((m = reSlot.exec(html))) slots.add(m[1]);

  const out = Array.from(slots);
  out.sort();
  if (out.length === 0) {
    console.error("ALL-SLOTS: no data-slot attributes found in", htmlPath);
  }
  return out;
}


const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");


const app = express();
const PORT = process.env.PORT || 3000;
const MAINTENANCE_MODE = false;

app.use((req, res, next) => {
  if (!MAINTENANCE_MODE) return next();

  return res.status(503).send(`
    <html>
      <head>
        <title>Maintenance</title>
        <style>
          body{
            font-family: system-ui;
            background:#f8fafc;
            display:flex;
            align-items:center;
            justify-content:center;
            height:100vh;
            margin:0;
            color:#111827;
          }
          .card{
            background:white;
            padding:40px;
            border-radius:12px;
            box-shadow:0 10px 30px rgba(0,0,0,0.08);
            text-align:center;
            max-width:420px;
          }
          h1{margin-bottom:10px}
          p{color:#6b7280}
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Maintenance</h1>
          <p>The Speaking Center system is temporarily offline for updates.</p>
          <p>Please check back shortly.</p>
        </div>
      </body>
    </html>
  `);
});

// Recommended: set ADMIN_PASSWORD in Render env vars instead of hardcoding
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGE_ME_IN_RENDER_ENV";

// Admin session signing (HMAC). Set ADMIN_SESSION_SECRET in env (recommended).
const ADMIN_SESSION_SECRET = (process.env.ADMIN_SESSION_SECRET || ADMIN_PASSWORD || "dev").trim();
const ADMIN_COOKIE_NAME = "admin_session";
const ADMIN_SESSION_MS = 1000 * 60 * 60 * 8; // 8 hours

// Render/HTTPS proxy support
app.set("trust proxy", 1);

// Basic cookie parser (no extra dependency)
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) return;
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signAdminPayload(payloadObj) {
  const payload = JSON.stringify(payloadObj);
  const payloadB64 = b64url(payload);
  const sig = crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(payloadB64)
    .digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${payloadB64}.${sig}`;
}

function verifyAdminCookieValue(val) {
  if (!val || typeof val !== "string") return null;
  const parts = val.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expected = crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(payloadB64)
    .digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  try {
  // timingSafeEqual throws if buffer lengths differ
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
} catch {
  return null;
}

  try {
    const json = Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json);
    if (!payload || payload.role !== "admin") return null;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  const payload = verifyAdminCookieValue(cookies[ADMIN_COOKIE_NAME]);
  if (!payload) return res.status(401).json({ ok: false, error: "unauthorized" });
  req.admin = payload;
  next();
}

// Slot parsing helpers (interprets slot as Europe/Istanbul time, +03:00)
function slotToDate(slot) {
  // slot format: YYYY-MM-DD-HH-MM
  const m = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.exec(String(slot || ""));
  if (!m) return null;
  const date = slot.slice(0, 10);
  const time = slot.slice(11).replace("-", ":");
  const d = new Date(`${date}T${time}:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function isoWeekKeyFromDate(d) {
  // d is a JS Date
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // ISO week-year is based on Thursday
  const day = date.getUTCDay() || 7; // Mon=1..Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day);

  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);

  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function isoWeekKeyFromSlot(slot) {
  const d = slotToDate(slot); // already Europe/Istanbul via +03:00
  if (!d) return null;
  return isoWeekKeyFromDate(d);
}

function nextIsoWeekKeyFromSlot(slot) {
  const d = slotToDate(slot);
  if (!d) return null;
  const next = new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000);
  return isoWeekKeyFromDate(next);
}
function isPastSlot(slot) {
  const d = slotToDate(slot);
  if (!d) return false;
  return d.getTime() < Date.now();
}
  
function isTooFarSlot(slot, maxDays = 10) {
  // slot: YYYY-MM-DD-HH-MM
  const s = String(slot || "").trim();
  const parts = s.split("-");
  if (parts.length < 5) return true;

  const mm = Number(parts.pop());
  const hh = Number(parts.pop());
  const date = parts.join("-");

  // Treat as Europe/Istanbul local time (UTC+03:00)
  const startIso = `${date}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00+03:00`;

  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return true;

  const nowMs = Date.now();
  const diffDays = (startMs - nowMs) / (1000 * 60 * 60 * 24);

  return diffDays > maxDays;
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
// ===== Google Calendar integration (startup-safe) =====

const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

let _google = null;     // will hold googleapis.google
let _gcalClient = null; // cached calendar client

const GCAL_TZ = "Europe/Istanbul";
const GCAL_EVENT_MINUTES = 30;
const GCAL_TIMEOUT_MS = 8000;

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} TIMEOUT after ${GCAL_TIMEOUT_MS}ms`)), GCAL_TIMEOUT_MS)
    ),
  ]);
}

function loadServiceAccountCreds() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;

  if (b64 && b64.trim()) {
    try {
      const decoded = Buffer.from(b64.trim(), "base64").toString("utf8");
      const creds = JSON.parse(decoded);
      if (creds.private_key) creds.private_key = String(creds.private_key).replace(/\\n/g, "\n");
      return creds;
    } catch (e) {
      console.error("GCAL AUTH ERROR: failed to parse GOOGLE_SERVICE_ACCOUNT_JSON_B64:", e?.message || e);
      return null;
    }
  }

  if (raw && raw.trim()) {
    try {
      const creds = JSON.parse(raw.trim());
      if (creds.private_key) creds.private_key = String(creds.private_key).replace(/\\n/g, "\n");
      return creds;
    } catch (e) {
      console.error("GCAL AUTH ERROR: failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:", e?.message || e);
      return null;
    }
  }

  return null;
}

function getGoogle() {
  if (_google) return _google;
  // Lazy-load googleapis ONLY when needed (prevents slow deploy/cold start)
  _google = require("googleapis").google;
  return _google;
}

async function getGoogleClient() {
  if (_gcalClient) return _gcalClient;

  if (!GOOGLE_CALENDAR_ID) {
    console.log("GCAL: disabled (missing GOOGLE_CALENDAR_ID)");
    return null;
  }

  const creds = loadServiceAccountCreds();
  if (!creds) {
    console.log("GCAL: disabled (missing/invalid service account creds)");
    return null;
  }

  const clientEmail = String(creds.client_email || "").trim();
  const privateKey = String(creds.private_key || "").trim();

  if (!clientEmail || !privateKey) {
    console.error("GCAL AUTH ERROR: missing client_email/private_key in creds");
    return null;
  }

  const google = getGoogle();

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  try {
    await withTimeout(auth.authorize(), "GCAL AUTH");
  } catch (e) {
    console.error("GCAL AUTH ERROR:", e?.message || e);
    return null;
  }

  _gcalClient = google.calendar({ version: "v3", auth });
  console.log("GCAL: ready as", clientEmail, "calendar:", GOOGLE_CALENDAR_ID);
  return _gcalClient;
}

// slot: YYYY-MM-DD-HH-MM (sessions 09:00–15:00, no midnight crossing)
function slotToGCalTimes(slot) {
  const s = String(slot || "").trim();
  const parts = s.split("-");
  if (parts.length < 5) return null;

  const mm = Number(parts.pop());
  const hh = Number(parts.pop());
  const date = parts.join("-"); // YYYY-MM-DD

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  // Optional: enforce your business hours
  if (hh < 9 || hh > 15) return null;

  const startMinutes = hh * 60 + mm;
  const endMinutes = startMinutes + GCAL_EVENT_MINUTES;

  const endH = Math.floor(endMinutes / 60);
  const endM = endMinutes % 60;

  const pad = (n) => String(n).padStart(2, "0");
  const startLocal = `${date}T${pad(hh)}:${pad(mm)}:00`;
  const endLocal = `${date}T${pad(endH)}:${pad(endM)}:00`;

  return { startLocal, endLocal };
}

async function createGoogleCalendarEvent({ slot, name, studentNo, email }) {
  try {
    const calendar = await getGoogleClient();
    if (!calendar) return null;

    const times = slotToGCalTimes(slot);
    if (!times) return null;
    const { startLocal, endLocal } = times;

    const resp = await withTimeout(
      calendar.events.insert({
        calendarId: GOOGLE_CALENDAR_ID,
        requestBody: {
          summary: `Speaking Center – ${name} (${studentNo})`,
          description: `Student: ${name}\nStudent No: ${studentNo}\nEmail: ${email}\nSlot: ${slot}`,
          start: { dateTime: startLocal, timeZone: GCAL_TZ },
          end: { dateTime: endLocal, timeZone: GCAL_TZ },
        },
      }),
      "GCAL INSERT"
    );

    const eventId = resp?.data?.id || null;
    console.log("GCAL: event created for", slot, "id=", eventId);
    return eventId;
  } catch (err) {
    console.error("GCAL CREATE ERROR:", err?.message || err);
    return null;
  }
}

async function updateGoogleCalendarEvent({ eventId, slot, name, studentNo, email }) {
  try {
    const calendar = await getGoogleClient();
    if (!calendar || !eventId) return false;

    const times = slotToGCalTimes(slot);
    if (!times) return false;
    const { startLocal, endLocal } = times;

    await withTimeout(
      calendar.events.patch({
        calendarId: GOOGLE_CALENDAR_ID,
        eventId,
        requestBody: {
          summary: `Speaking Center – ${name} (${studentNo})`,
          description: `Student: ${name}\nStudent No: ${studentNo}\nEmail: ${email}\nSlot: ${slot}`,
          start: { dateTime: startLocal, timeZone: GCAL_TZ },
          end: { dateTime: endLocal, timeZone: GCAL_TZ },
        },
      }),
      "GCAL PATCH"
    );

    console.log("GCAL: event updated", eventId, "->", slot);
    return true;
  } catch (err) {
    console.error("GCAL UPDATE ERROR:", err?.message || err);
    return false;
  }
}

async function deleteGoogleCalendarEvent({ eventId }) {
  try {
    const calendar = await getGoogleClient();
    if (!calendar || !eventId) return false;

    await withTimeout(
      calendar.events.delete({
        calendarId: GOOGLE_CALENDAR_ID,
        eventId,
      }),
      "GCAL DELETE"
    );

    console.log("GCAL: event deleted", eventId);
    return true;
  } catch (err) {
    // If already deleted, Google often returns 404 — treat as “done”
    if (String(err?.code) === "404") return true;
    console.error("GCAL DELETE ERROR:", err?.message || err);
    return false;
  }
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
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gcal_event_id TEXT;`);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS bookings_manage_token_hash_unique
      ON bookings (manage_token_hash)
      WHERE manage_token_hash IS NOT NULL;
    `);

    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS week_key TEXT;`);

// Backfill for existing rows (safe; no deletes)
await pool.query(`
  UPDATE bookings
  SET week_key =
    to_char(
      (to_timestamp(replace(slot, '-', ' '), 'YYYY MM DD HH MI') at time zone 'Europe/Istanbul')::date,
      'IYYY-"W"IW'
    )
  WHERE week_key IS NULL;
`);

await pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_per_student_week
  ON bookings (student_no, week_key)
  WHERE student_no IS NOT NULL AND week_key IS NOT NULL;
`);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_blocks (
    id BIGSERIAL PRIMARY KEY,
    student_no TEXT NOT NULL,
    blocked_week_key TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'cancel_penalty',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

await pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS booking_blocks_unique
  ON booking_blocks (student_no, blocked_week_key);
`);

    console.log("DB ready: bookings table ok");
  } catch (err) {
    console.error("DB init failed:", err);
  }
})();

// ---------- API ----------

// Frontend uses this to mark booked slots on load

app.get("/api/availability", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT slot FROM bookings");
    return res.json({ booked: rows.map(r => r.slot) });
  } catch (err) {
    console.error("AVAILABILITY GET ERROR:", err);
    return res.json({ booked: [] });
  }
});

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
    return res.json(out);
  } catch (err) {
    console.error("BOOKINGS GET ERROR:", err);
    return res.json({});
  }
});

app.post("/api/book", async (req, res) => {
  const { slot, name, studentNo, email } = req.body || {};

  if (isPastSlot(slot)) {
    return res.status(400).json({ ok: false, error: "past_slot" });
  }

  if (!slot || !name || !studentNo || !email) {
    return res.status(400).json({ ok: false, error: "Missing fields" });
  }
  if (isTooFarSlot(slot, 10)) {
    return res.status(400).json({ ok: false, error: "too_far" });
  }

  const sn = normStudentNo(studentNo);
  const nm = String(name).trim();
  const em = String(email).trim().toLowerCase();
  if (
  !em.endsWith("@ankaramedipol.edu.tr") &&
  !em.endsWith("@std.ankaramedipol.edu.tr")
) {
  return res.status(400).json({ ok: false, error: "invalid_email_domain" });
}
// === NEW: deny if student is blocked for this week ===
    const weekKey = isoWeekKeyFromSlot(slot);
    if (weekKey) {
    const blocked = await pool.query(
    `SELECT 1 FROM booking_blocks WHERE student_no = $1 AND blocked_week_key = $2 LIMIT 1`,
    [sn, weekKey]
  );
  if (blocked.rowCount > 0) {
    return res.status(403).json({ ok: false, error: "blocked_next_week" });
  }
}
  if (!ALLOWED_STUDENTS.has(sn)) {
    return res.status(403).json({ ok: false, error: "Not allowed" });
  }

  try {
    const manageToken = crypto.randomBytes(32).toString("hex");
    const manageTokenHash = crypto.createHash("sha256").update(manageToken).digest("hex");

    const q = `
      INSERT INTO bookings (slot, name, student_no, email, manage_token_hash, week_key)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (slot) DO NOTHING
      RETURNING slot
    `;

    const result = await pool.query(q, [slot, nm, sn, em, manageTokenHash, weekKey]);

    if (result.rowCount === 0) {
      return res.status(409).json({ ok: false, error: "Slot already booked" });
    }

    // fire-and-forget manage link email
    sendManageLinkEmail({ to: em, name: nm, slot, token: manageToken }).catch((e) =>
      console.error("EMAIL ERROR:", e?.message || e)
    );

    // Fire-and-forget Google Calendar: create event, then store event id on the booking
    createGoogleCalendarEvent({ slot, name: nm, studentNo: sn, email: em })
      .then((eventId) => {
        if (!eventId) return;
        return pool
          .query("UPDATE bookings SET gcal_event_id = $1 WHERE manage_token_hash = $2", [eventId, manageTokenHash])
          .catch((e) => console.error("GCAL STORE ERROR:", e?.message || e));
      })
      .catch((e) => console.error("GCAL ERROR:", e?.message || e));

    // respond ONCE (don't wait for email/calendar)
    return res.json({ ok: true, manageToken });
  } catch (err) {
  console.error("BOOK ERROR:", err);

  if (err && err.code === "23505") {
  return res.status(409).json({ ok: false, error: "one_per_week" });
  }
  if (res.headersSent) return;
  return res.status(500).json({ ok: false, error: "Server error" });
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
      `SELECT slot, name, email, gcal_event_id, student_no
      FROM bookings
      WHERE manage_token_hash = $1
      LIMIT 1`,
      [tokenHash]
    );

    if (!cur.rows.length) {
      // Idempotent cancel: booking already cancelled/deleted
      return res.json({ ok: true, alreadyCancelled: true });
    }

    const b = cur.rows[0];
    

    const result = await pool.query(
      `DELETE FROM bookings
       WHERE manage_token_hash = $1
       RETURNING slot`,
      [tokenHash]
    );

    if (result.rowCount === 0) {
      // Idempotent cancel: booking already cancelled/deleted
      return res.json({ ok: true, alreadyCancelled: true });
    }
    // === NEW: cancel penalty => block NEXT week from booking ===
    if (b.student_no) {
    const blockedWeekKey = nextIsoWeekKeyFromSlot(b.slot);
    if (blockedWeekKey) {
    await pool.query(
      `INSERT INTO booking_blocks (student_no, blocked_week_key, reason)
       VALUES ($1, $2, 'cancel_penalty')
       ON CONFLICT (student_no, blocked_week_key) DO NOTHING`,
      [normStudentNo(b.student_no), blockedWeekKey]
    );
    }
    }

    // fire-and-forget email
    sendCancelledEmail({ to: b.email, name: b.name, oldSlot: b.slot }).catch((e) =>
      console.error("EMAIL CANCEL ERROR:", e)
    );

    // fire-and-forget gcal delete
    if (b.gcal_event_id) {
      deleteGoogleCalendarEvent({ eventId: b.gcal_event_id }).catch((e) =>
        console.error("GCAL DELETE ERROR:", e?.message || e)
      );
    }

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
    if (isPastSlot(newSlot)) {
    return res.status(400).json({ ok: false, error: "past_slot" });
  }

  if (isTooFarSlot(newSlot, 10)) {
    return res.status(400).json({ ok: false, error: "too_far" });
  }
  
  const newWeekKey = isoWeekKeyFromSlot(newSlot);
if (!newWeekKey) {
  return res.status(400).json({ ok: false, error: "bad_slot" });
}
  

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const cur = await client.query(
      `SELECT slot, name, student_no, email, gcal_event_id
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
  `INSERT INTO bookings (slot, name, student_no, email, manage_token_hash, gcal_event_id, week_key, reminder_sent)
   VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
  [newSlot, current.name, current.student_no, current.email, tokenHash, current.gcal_event_id || null, newWeekKey]
);

    await client.query("COMMIT");

    // fire-and-forget calendar sync
    if (current.gcal_event_id) {
      updateGoogleCalendarEvent({
        eventId: current.gcal_event_id,
        slot: newSlot,
        name: current.name,
        studentNo: current.student_no,
        email: current.email,
      }).catch((e) => console.error("GCAL UPDATE ERROR:", e?.message || e));
    } else {
      createGoogleCalendarEvent({
        slot: newSlot,
        name: current.name,
        studentNo: current.student_no,
        email: current.email,
      })
        .then((eventId) => {
          if (!eventId) return;
          return pool
            .query("UPDATE bookings SET gcal_event_id = $1 WHERE manage_token_hash = $2", [eventId, tokenHash])
            .catch((e) => console.error("GCAL STORE ERROR:", e?.message || e));
        })
        .catch((e) => console.error("GCAL CREATE ERROR:", e?.message || e));
    }

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
app.delete("/api/cancel/:slot", async (req, res) => {
  const pw = req.query.pw;
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ message: "Unauthorized" });

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
// All slots (source of truth: parsed from index.html so Manage matches main page)
app.get("/api/all-slots", (req, res) => {
  const slots = readSlotsFromIndexHtml();
  return res.json(slots);
});

// Static files

// ===== Admin auth + routes =====
app.post("/api/admin/login", (req, res) => {
  const pw = String((req.body && req.body.password) || "").trim();
  const expected = String(ADMIN_PASSWORD || "").trim();
  if (!expected || expected === "CHANGE_ME_IN_RENDER_ENV") {
  console.error("ADMIN_PASSWORD is missing or still default. Set it in Render env and restart the service.");
  return res.status(500).json({
    ok: false,
    error: "admin_password_not_set",
    hint: "Set ADMIN_PASSWORD in your Render service Environment and restart/redeploy."
  });
}
  if (pw !== expected) return res.status(401).json({ ok: false, error: "invalid_password" });

  const cookieValue = signAdminPayload({ role: "admin", exp: Date.now() + ADMIN_SESSION_MS });
  // Always Secure in production HTTPS; Render terminates TLS at proxy.
  res.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${Math.floor(
      ADMIN_SESSION_MS / 1000
    )}`
  );
  return res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  res.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`
  );
  return res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  const cookies = parseCookies(req);
  const payload = verifyAdminCookieValue(cookies[ADMIN_COOKIE_NAME]);
  if (!payload) return res.status(401).json({ ok: false });
  return res.json({ ok: true });
});

// Simple health check for admin auth config (does not reveal secrets)
app.get("/api/admin/ping", (req, res) => {
  const expected = String(ADMIN_PASSWORD || "").trim();
  return res.json({
    ok: true,
    adminPasswordConfigured: !!(expected && expected !== "CHANGE_ME_IN_RENDER_ENV"),
    cookieName: ADMIN_COOKIE_NAME
  });
});


app.get("/api/admin/bookings", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT slot, booked_at, name, student_no, email FROM bookings");
    return res.json(rows);
  } catch (err) {
    console.error("ADMIN BOOKINGS ERROR:", err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.delete("/api/admin/cancel/:slot", requireAdmin, async (req, res) => {
  const slot = req.params.slot;
  try {
    // Fetch booking details first so we can notify + clean up calendar
    const cur = await pool.query(
      `SELECT slot, name, student_no, email, gcal_event_id
       FROM bookings
       WHERE slot = $1
       LIMIT 1`,
      [slot]
    );

    if (cur.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const b = cur.rows[0];
    // Apply no-show / admin cancel penalty: block next week
if (b.student_no) {
  const blockedWeekKey = nextIsoWeekKeyFromSlot(b.slot);
  if (blockedWeekKey) {
    await pool.query(
      `INSERT INTO booking_blocks (student_no, blocked_week_key, reason)
       VALUES ($1, $2, 'missed_appointment')
       ON CONFLICT (student_no, blocked_week_key) DO NOTHING`,
      [normStudentNo(b.student_no), blockedWeekKey]
    );
  }
}

    await pool.query("DELETE FROM bookings WHERE slot=$1", [slot]);

    // fire-and-forget cancellation email
    sendCancelledEmail({ to: b.email, name: b.name, oldSlot: b.slot }).catch((e) =>
      console.error("ADMIN CANCEL EMAIL ERROR:", e?.message || e)
    );

    // fire-and-forget gcal delete
    if (b.gcal_event_id) {
      deleteGoogleCalendarEvent({ eventId: b.gcal_event_id }).catch((e) =>
        console.error("ADMIN CANCEL GCAL DELETE ERROR:", e?.message || e)
      );
    }

    return res.json({ ok: true, message: "Cancelled" });
  } catch (err) {
    console.error("ADMIN CANCEL ERROR:", err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});
// ===== Admin: view & remove cancel-block penalties =====

// List all blocked students (most recent first)
app.get("/api/admin/blocks", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, student_no, blocked_week_key, reason, created_at
       FROM booking_blocks
       ORDER BY created_at DESC
       LIMIT 500`
    );
    return res.json({ ok: true, blocks: rows });
  } catch (err) {
    console.error("ADMIN BLOCKS LIST ERROR:", err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Remove a specific block row by id (safest)
app.delete("/api/admin/blocks/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "bad_id" });

  try {
    const result = await pool.query(
      `DELETE FROM booking_blocks
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("ADMIN BLOCK DELETE ERROR:", err);
    return res.status(500).json({ ok: false, error: "db_error" });
  }
});
// Hide direct static access to admin.html; serve via /admin route only.
app.get("/admin.html", (req, res) => res.status(404).send("Not found"));

app.get("/admin", (req, res) => {
  const cookies = parseCookies(req);
  const payload = verifyAdminCookieValue(cookies[ADMIN_COOKIE_NAME]);
  if (!payload) return res.redirect("/admin-login");
  return res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/admin-login", (req, res) => {
  return res.sendFile(path.join(__dirname, "public", "admin-login.html"));
});

app.use(express.static(path.join(__dirname, "public")));

// Self-ping (Render)
const SELF_URL = process.env.RENDER_EXTERNAL_URL;

if (SELF_URL) {
  setInterval(() => {
    fetch(SELF_URL)
      .catch((err) => console.error("Self ping failed:", err.message));
  }, 4 * 60 * 1000);
}
async function sendReminderEmail({ to, name, slot }) {
  console.log("Running reminder job...");
  if (!RESEND_API_KEY || !RESEND_FROM) return;
  if (!to) return;

  const subject = "Speaking Center Reminder – Tomorrow";
  const text =
    `Hello${name ? " " + name : ""},\n\n` +
    `This is a reminder of your Speaking Center appointment tomorrow.\n\n` +
    `Slot: ${slot}\n` +
    `Location: MB-103 (Lower Level, Floor -1)\n` +
    `Instructor: Serdar Soyer\n\n` +
    `If you cannot attend, please use the link in your booking email to manage your appointment.\n`;

  const html =
    `<p>Hello${name ? " " + escapeHtml(name) : ""},</p>` +
    `<p>This is a reminder of your Speaking Center appointment tomorrow.</p>` +
    `<p><b>Slot:</b> ${escapeHtml(slot)}<br>` +
    `<b>Location:</b> MB-103 (Lower Level, Floor -1)<br>` +
    `<b>Instructor:</b> Serdar Soyer</p>` +
    `<p>If you cannot attend, please use the link in your booking email to manage your appointment.</p>`;

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
      console.error("EMAIL: reminder failed", resp.status, body);
      return;
    }

    console.log("EMAIL: reminder sent to", to);
  } catch (e) {
    console.error("EMAIL: reminder error:", e);
  }
}
async function runReminderJob() {
  console.log("Running reminder job...");
  try {
    const { rows } = await pool.query(`
      SELECT slot, name, email
      FROM bookings
      WHERE slot like to_char(now() + interval '1 day', 'YYYY-MM-DD') || '%'
AND reminder_sent = false
    `);

    for (const b of rows) {

  await sendReminderEmail({
    to: b.email,
    name: b.name,
    slot: b.slot
  });

  await pool.query(
    `UPDATE bookings SET reminder_sent = true WHERE slot = $1`,
    [b.slot]
  );

  // avoid Resend rate limit
  await new Promise(r => setTimeout(r, 600));
}

    if (rows.length > 0) {
      console.log("REMINDERS SENT:", rows.length);
    }

  } catch (err) {
    console.error("REMINDER JOB ERROR:", err);
  }
}
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// run every 30 minutes
setInterval(runReminderJob, 1000 * 60 * 30);
