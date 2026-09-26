/**
 * routes/admin.js
 *
 * Admin authentication + protected admin endpoints.
 *
 * Flow:
 *   1. POST /api/admin/login with ADMIN_PASSWORD
 *   2. Server creates a temporary admin session
 *   3. Session ID is stored in a secure HttpOnly cookie
 *   4. Protected admin endpoints verify that session
 *
 * The actual ADMIN_PASSWORD is no longer sent with every admin request.
 */

const crypto = require("crypto");
const express = require("express");
const db = require("../lib/db");

const router = express.Router();

// Temporary in-memory admin sessions.
// Sessions disappear if the server restarts.
const adminSessions = new Map();

// Session lifetime: 2 hours
const SESSION_DURATION = 2 * 60 * 60 * 1000;

/**
 * POST /api/admin/login
 *
 * Checks the admin password and creates a temporary session.
 */
router.post("/login", (req, res) => {
  const provided = req.body?.password;
  const expected = process.env.ADMIN_PASSWORD;

  if (!provided || !expected) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const sessionId = crypto.randomBytes(32).toString("hex");

  adminSessions.set(sessionId, {
    expiresAt: Date.now() + SESSION_DURATION,
  });

  res.setHeader(
    "Set-Cookie",
    `admin_session=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${
      SESSION_DURATION / 1000
    }`
  );

  res.setHeader("Cache-Control", "no-store");

  res.json({ success: true });
});

/**
 * POST /api/admin/logout
 *
 * Deletes the current admin session.
 */
router.post("/logout", (req, res) => {
  const sessionId = getSessionId(req);

  if (sessionId) {
    adminSessions.delete(sessionId);
  }

  res.setHeader(
    "Set-Cookie",
    "admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
  );

  res.setHeader("Cache-Control", "no-store");

  res.json({ success: true });
});

/**
 * Extract the admin session ID from the Cookie header.
 */
function getSessionId(req) {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split("=");

    if (name === "admin_session") {
      return valueParts.join("=") || null;
    }
  }

  return null;
}

/**
 * Protect all admin endpoints below this point.
 */
function requireAdminSession(req, res, next) {
  const sessionId = getSessionId(req);

  if (!sessionId) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const session = adminSessions.get(sessionId);

  if (!session) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (Date.now() > session.expiresAt) {
    adminSessions.delete(sessionId);

    return res.status(401).json({ error: "Session expired." });
  }

  next();
}

router.use(requireAdminSession);

router.get("/orders", async (req, res) => {
  const orders = (await db.readAll()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  res.setHeader("Cache-Control", "no-store");
  res.json(orders);
});

router.get("/summary", async (req, res) => {
  const orders = await db.readAll();

  const delivered = orders.filter(
    (o) => o.fulfillmentStatus === "delivered"
  );

  const totalRevenue = delivered.reduce(
    (sum, o) => sum + o.sellingPrice,
    0
  );

  const totalCost = delivered.reduce(
    (sum, o) => sum + o.wholesaleCost,
    0
  );

  const totalProfit = delivered.reduce(
    (sum, o) => sum + o.profit,
    0
  );

  const needsReview = orders.filter(
    (o) => o.needsManualReview
  ).length;

  res.setHeader("Cache-Control", "no-store");

  res.json({
    totalOrders: orders.length,
    deliveredOrders: delivered.length,
    totalRevenue,
    totalCost,
    totalProfit,
    needsManualReview: needsReview,
  });
});

module.exports = router;
