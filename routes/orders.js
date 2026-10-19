
/**
 * routes/orders.js
 *
 * Customer-facing order endpoints.
 */

const express = require("express");
const { nanoid } = require("nanoid");
const {
  getPlanById,
  totalWholesaleCost,
} = require("../config/plans");
const { initializeTransaction } = require("../lib/paystack");
const db = require("../lib/db");

const router = express.Router();

function isValidNigerianNumber(num) {
  return /^0\d{10}$/.test(num);
}

router.post("/orders", async (req, res) => {
  try {
    const {
      planId,
      mobileNumber,
      customerEmail,
      paymentMethod,
    } = req.body;

    if (!planId || !mobileNumber) {
      return res.status(400).json({
        error: "planId and mobileNumber are required.",
      });
    }

    if (!isValidNigerianNumber(mobileNumber)) {
      return res.status(400).json({
        error:
          "mobileNumber must be an 11-digit Nigerian number, e.g. 08012345678.",
      });
    }

    // Get the current selling price and enabled status from MongoDB.
    const databasePlan = await db.findPlanById(planId);

    // Keep the configured plan for fulfillment-related information.
    const configuredPlan = getPlanById(planId);

    if (!databasePlan || !configuredPlan) {
      return res.status(404).json({
        error: `Unknown planId "${planId}".`,
      });
    }

    // Prevent purchases of plans disabled in the admin dashboard.
    if (databasePlan.enabled !== true) {
      return res.status(400).json({
        error: "This data plan is currently unavailable.",
      });
    }

    const sellingPrice = databasePlan.sellingPrice;
    const wholesaleCost = totalWholesaleCost(configuredPlan);

    const orderId = nanoid(12);
    const paystackReference = `mst_${orderId}`;
    const email =
      customerEmail ||
      `${paystackReference}@michaelstacktelecoms.com`;

    const channelMap = {
      card: ["card"],
    };

    const channels = channelMap[paymentMethod];

    const { authorizationUrl, accessCode } =
      await initializeTransaction({
        email,
        amountNaira: sellingPrice,
        reference: paystackReference,
        callbackUrl:
          `${process.env.PUBLIC_BASE_URL}/payment-complete?ref=${paystackReference}`,
        channels,
      });

    await db.createOrder({
      id: orderId,
      planId: databasePlan.id,
      network: databasePlan.network,
      size: databasePlan.size,
      validity: databasePlan.validity,
      mobileNumber,
      sellingPrice,
      wholesaleCost,
      profit: sellingPrice - wholesaleCost,
      paystackReference,
      paymentStatus: "pending",
      fulfillmentStatus: "not_started",
      createdAt: new Date().toISOString(),
    });

    return res.json({
      orderId,
      paystackReference,
      checkoutUrl: authorizationUrl,
      accessCode,
    });
  } catch (err) {
    console.error("Error creating order:", err.message);

    if (err.response) {
      console.error(
        "Paystack response data:",
        JSON.stringify(err.response.data)
      );
    }

    return res.status(500).json({
      error:
        "Something went wrong creating your order. Please try again.",
    });
  }
});

router.get("/orders/by-reference/:ref", async (req, res) => {
  try {
    const order = await db.findByReference(req.params.ref);

    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    return res.json(order);
  } catch (err) {
    console.error("Error finding order by reference:", err.message);
    return res.status(500).json({ error: "Unable to retrieve order." });
  }
});

router.get("/orders/:id", async (req, res) => {
  try {
    const order = await db.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    return res.json(order);
  } catch (err) {
    console.error("Error finding order:", err.message);
    return res.status(500).json({ error: "Unable to retrieve order." });
  }
});

module.exports = router;
