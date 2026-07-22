/**
 *  * routes/orders.js
 *   *
 *    * Customer-facing order endpoints.
 *     */

const express = require("express");
const { nanoid } = require("nanoid");
const { getPlanById, totalWholesaleCost } = require("../config/plans");
const { initializeTransaction } = require("../lib/paystack");
const db = require("../lib/db");

const router = express.Router();

function isValidNigerianNumber(num) {
	  return /^0\d{10}$/.test(num);
}

router.post("/orders", async (req, res) => {
	  try {
		      const { planId, mobileNumber, customerEmail, paymentMethod } = req.body;

		      if (!planId || !mobileNumber) {
				        return res.status(400).json({ error: "planId and mobileNumber are required." });
				      }
		      if (!isValidNigerianNumber(mobileNumber)) {
				        return res.status(400).json({ error: "mobileNumber must be an 11-digit Nigerian number, e.g. 08012345678." });
				      }

		      const plan = getPlanById(planId);
		      if (!plan) {
				        return res.status(404).json({ error: `Unknown planId "${planId}".` });
				      }

		      const orderId = nanoid(12);
		      const paystackReference = `mst_${orderId}`;
		      const email = customerEmail || `${paystackReference}@michaelstacktelecoms.com`;

		      const channelMap = {
				        bank_transfer: ["bank_transfer"],
				        card: ["card"],
				      };
		      const channels = channelMap[paymentMethod] || ["card", "bank_transfer"];

		      const { authorizationUrl, accessCode } = await initializeTransaction({
				        email,
				        amountNaira: plan.sellingPrice,
				        reference: paystackReference,
				        callbackUrl: `${process.env.PUBLIC_BASE_URL}/payment-complete?ref=${paystackReference}`,
				        channels,
				      });

		      db.createOrder({
				        id: orderId,
				        planId: plan.id,
				        network: plan.network,
				        size: plan.size,
				        validity: plan.validity,
				        mobileNumber,
				        sellingPrice: plan.sellingPrice,
				        wholesaleCost: totalWholesaleCost(plan),
				        profit: plan.sellingPrice - totalWholesaleCost(plan),
				        paystackReference,
				        paymentStatus: "pending",
				        fulfillmentStatus: "not_started",
				        createdAt: new Date().toISOString(),
				      });

		      res.json({ orderId, paystackReference, checkoutUrl: authorizationUrl, accessCode });
		    } catch (err) {
				    console.error("Error creating order:", err.message);
				    if (err.response) {
						      console.error("Paystack response data:", JSON.stringify(err.response.data));
						    }
				    res.status(500).json({ error: "Something went wrong creating your order. Please try again." });
				  }
});

router.get("/orders/by-reference/:ref", (req, res) => {
	  const order = db.findByReference(req.params.ref);
	  if (!order) return res.status(404).json({ error: "Order not found." });
	  res.json(order);
});

router.get("/orders/:id", (req, res) => {
	  const order = db.findById(req.params.id);
	  if (!order) return res.status(404).json({ error: "Order not found." });
	  res.json(order);
});

module.exports = router;
