
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
const { calculateProfit } = require("../lib/profit");

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

/**
 * GET /api/admin/plans
 *
 * Return existing plans and editable fields for the admin dashboard.
 * Wholesale costs and provider details are not exposed.
 */
router.get("/plans", async (req, res) => {
  try {
    const plans = await db.readPlans();

    res.setHeader("Cache-Control", "no-store");

    return res.json(
      plans.map((plan) => ({
        id: plan.id,
        network: plan.network,
        size: plan.size,
        validity: plan.validity,
        sellingPrice: plan.sellingPrice,
        enabled: plan.enabled === true,
      }))
    );
  } catch (err) {
    console.error("Error reading admin plans:", err.message);

    return res.status(500).json({
      error: "Unable to retrieve data plans.",
    });
  }
});

/**
 * PATCH /api/admin/plans/:id
 *
 * Update only the selling price and enabled status.
 */
router.patch("/plans/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const allowedFields = ["sellingPrice", "enabled"];

    const submittedFields = Object.keys(body);

    if (
      submittedFields.length === 0 ||
      submittedFields.some((field) => !allowedFields.includes(field))
    ) {
      return res.status(400).json({
        error: "Submit a sellingPrice, enabled status, or both.",
      });
    }

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(body, "sellingPrice")) {
      const price = body.sellingPrice;

      if (
        typeof price !== "number" ||
        !Number.isFinite(price) ||
        !Number.isInteger(price) ||
        price < 1 ||
        price > 1000000
      ) {
        return res.status(400).json({
          error: "Selling price must be a whole number from ₦1 to ₦1,000,000.",
        });
      }

      updates.sellingPrice = price;
    }

    if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
      if (typeof body.enabled !== "boolean") {
        return res.status(400).json({
          error: "Enabled must be true or false.",
        });
      }

      updates.enabled = body.enabled;
    }

    const existingPlan = await db.findPlanById(id);

    if (!existingPlan) {
      return res.status(404).json({
        error: "Data plan not found.",
      });
    }

    const updatedPlan = await db.updatePlan(id, updates);

    if (!updatedPlan) {
      return res.status(404).json({
        error: "Data plan not found.",
      });
    }

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      plan: {
        id: updatedPlan.id,
        network: updatedPlan.network,
        size: updatedPlan.size,
        validity: updatedPlan.validity,
        sellingPrice: updatedPlan.sellingPrice,
        enabled: updatedPlan.enabled === true,
      },
    });
  } catch (err) {
    console.error("Error updating admin plan:", err.message);

    return res.status(500).json({
      error: "Unable to update data plan.",
    });
  }
});

router.get("/orders", async (req, res) => {
  try {
    const orders = (await db.readAll()).sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.setHeader("Cache-Control", "no-store");
    return res.json(orders);
  } catch (err) {
    console.error("Error reading admin orders:", err.message);

    return res.status(500).json({
      error: "Unable to retrieve admin orders.",
    });
  }
});


/**
 * PATCH /api/admin/orders/:id/resolve-review
 *
 * Mark a flagged order as reviewed without changing its
 * fulfillment status, payment reference, or financial fields.
 */
router.patch("/orders/:id/resolve-review", async (req, res) => {
  try {
    const { id } = req.params;

    const order = await db.findById(id);

    if (!order) {
      return res.status(404).json({
        error: "Order not found.",
      });
    }

    if (!order.needsManualReview) {
      return res.status(400).json({
        error: "This order is not flagged for manual review.",
      });
    }

    const updatedOrder = await db.updateOrder(id, {
      reviewResolved: true,
      reviewResolvedAt: new Date().toISOString(),
    });

    if (!updatedOrder) {
      return res.status(404).json({
        error: "Order not found.",
      });
    }

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      order: updatedOrder,
    });
  } catch (err) {
    console.error("Error resolving order review:", err.message);

    return res.status(500).json({
      error: "Unable to mark order as reviewed.",
    });
  }
});


router.get("/summary", async (req, res) => {
  try {
    const orders = await db.readAll();

    const delivered = orders.filter(
      (o) => o.fulfillmentStatus === "delivered"
    );

    const totalRevenue = delivered.reduce(
      (sum, o) => sum + Number(o.sellingPrice || 0),
      0
    );

    const totalCost = delivered.reduce(
      (sum, o) => sum + Number(o.wholesaleCost || 0),
      0
    );

    let totalProfit = 0;

    for (const order of delivered) {
      const sellingPrice = Number(order.sellingPrice);
      const wholesaleCost = Number(order.wholesaleCost);

      // Exclude orders without reliable cost data from the profit calculation.
      if (
        !Number.isFinite(sellingPrice) ||
        !Number.isFinite(wholesaleCost) ||
        sellingPrice < 0 ||
        wholesaleCost < 0
      ) {
        continue;
      }

      const { profit } = calculateProfit({
        sellingPrice,
        wholesaleCost,
      });

      totalProfit += profit;
    }

    const profitMargin =
      totalRevenue > 0
        ? (totalProfit / totalRevenue) * 100
        : 0;

    const needsReview = orders.filter(
      (o) => o.needsManualReview && !o.reviewResolved
    ).length;

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      totalOrders: orders.length,
      deliveredOrders: delivered.length,
      totalRevenue,
      totalCost,
      totalProfit,
      profitMargin,
      needsManualReview: needsReview,
    });
  } catch (err) {
    console.error("Error generating admin summary:", err.message);

    return res.status(500).json({
      error: "Unable to retrieve admin summary.",
    });
  }
});



module.exports = router;
