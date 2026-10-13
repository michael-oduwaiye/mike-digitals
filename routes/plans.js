
/**
 * routes/plans.js
 *
 * Public endpoint for customer-facing data plans.
 * Reads plans from MongoDB and returns only the fields customers need.
 * Wholesale costs and provider fulfillment details are not exposed.
 */

const express = require("express");
const db = require("../lib/db");

const router = express.Router();

router.get("/plans", async (req, res) => {
  try {
    const plans = await db.readPlans({ enabledOnly: true });

    const publicPlans = plans.map((plan) => ({
      id: plan.id,
      network: plan.network,
      size: plan.size,
      validity: plan.validity,
      sellingPrice: plan.sellingPrice,
    }));

    res.setHeader("Cache-Control", "no-store");
    res.json(publicPlans);
  } catch (err) {
    console.error("Error retrieving plans:", err.message);
    res.status(500).json({
      error: "Unable to retrieve data plans at this time.",
    });
  }
});

module.exports = router;
