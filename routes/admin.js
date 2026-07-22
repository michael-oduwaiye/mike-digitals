/**
 * routes/admin.js
 *
 * Basic password-protected admin endpoints. This is a minimal version —
 * we'll build out the full dashboard (step 2 of the roadmap) on top of this.
 *
 * Protection is a simple shared password via header, e.g.:
 *   GET /api/admin/orders
 *   Header: x-admin-password: <your ADMIN_PASSWORD from .env>
 *
 * This is fine for a one-person business checking their own dashboard.
 * If you ever add staff/multiple admins, upgrade to real login + sessions.
 */

const express = require("express");
const db = require("../lib/db");

const router = express.Router();

function requireAdminPassword(req, res, next) {
  const provided = req.headers["x-admin-password"];
  if (!provided || provided !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  next();
}

router.use(requireAdminPassword);

router.get("/orders", (req, res) => {
  const orders = db.readAll().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(orders);
});

router.get("/summary", (req, res) => {
  const orders = db.readAll();
  const delivered = orders.filter((o) => o.fulfillmentStatus === "delivered");
  const totalRevenue = delivered.reduce((sum, o) => sum + o.sellingPrice, 0);
  const totalCost = delivered.reduce((sum, o) => sum + o.wholesaleCost, 0);
  const totalProfit = delivered.reduce((sum, o) => sum + o.profit, 0);
  const needsReview = orders.filter((o) => o.needsManualReview).length;

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
