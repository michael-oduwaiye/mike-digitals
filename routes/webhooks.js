/**
 * routes/webhooks.js
 *
 * Two separate webhook receivers:
 *
 * 1. POST /webhooks/paystack
 *    Paystack calls this when a payment's status changes. We verify the
 *    event is genuinely successful, then trigger the Gladtidings delivery.
 *    This is the "confirm payment -> deliver data" handoff point.
 *
 * 2. POST /webhooks/gladtidings
 *    Gladtidings calls this to confirm whether a data delivery succeeded or
 *    failed (matches the sample payloads you found in their Postman docs).
 *    Since we already fire the Gladtidings call directly and get an
 *    immediate response (see lib/gladtidings.js), this webhook mostly
 *    serves as a secondary confirmation / reconciliation check — useful if
 *    a delivery is delayed or processed asynchronously on their end.
 *
 * SECURITY NOTE: In production, verify Paystack's webhook signature
 * (x-paystack-signature header, HMAC SHA512 using your secret key) before
 * trusting the payload. A placeholder check is included below — do not
 * skip this before going live, or anyone could fake a "payment successful"
 * call to your server.
 */

const express = require("express");
const crypto = require("crypto");
const db = require("../lib/db");
const { getPlanById } = require("../config/plans");
const { fulfillPlan } = require("../lib/gladtidings");
const { verifyTransaction } = require("../lib/paystack");

const router = express.Router();

function isValidPaystackSignature(req) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.headers["x-paystack-signature"];
  if (!secret || !signature) return false;
  const hash = crypto.createHmac("sha512", secret).update(req.rawBody || "").digest("hex");
  return hash === signature;
}

router.post("/webhooks/paystack", express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
}), async (req, res) => {
  // Always respond 200 quickly so Paystack doesn't retry unnecessarily —
  // do the real work after acknowledging receipt.
  res.sendStatus(200);

  if (!isValidPaystackSignature(req)) {
    console.warn("Rejected webhook: invalid Paystack signature.");
    return;
  }

  const event = req.body;
  if (event.event !== "charge.success") return;

  const reference = event.data.reference;
  const order = db.findByReference(reference);
  if (!order) {
    console.warn(`Webhook received for unknown order reference: ${reference}`);
    return;
  }
  if (order.paymentStatus === "paid") {
    // Already processed — Paystack can send duplicate webhooks, ignore safely.
    return;
  }

  // Double-check with Paystack directly rather than trusting the webhook body alone.
  const verification = await verifyTransaction(reference);
  if (verification.status !== "success") {
    db.updateOrder(order.id, { paymentStatus: "failed" });
    return;
  }

  db.updateOrder(order.id, { paymentStatus: "paid", paidAt: new Date().toISOString() });

  // Payment confirmed — now deliver the data.
  const plan = getPlanById(order.planId);
  if (!plan) {
    console.error(`Cannot fulfill order ${order.id}: plan ${order.planId} no longer exists in config.`);
    db.updateOrder(order.id, { fulfillmentStatus: "failed", fulfillmentError: "Plan config missing." });
    return;
  }

  try {
    const result = await fulfillPlan(plan, order.mobileNumber);
    if (result.fullySuccessful) {
      db.updateOrder(order.id, {
        fulfillmentStatus: "delivered",
        fulfillmentResults: result.results,
        deliveredAt: new Date().toISOString(),
      });
    } else if (result.partiallyDelivered) {
      // Customer got SOME data but not all — needs manual follow-up.
      db.updateOrder(order.id, {
        fulfillmentStatus: "partial",
        fulfillmentResults: result.results,
        needsManualReview: true,
      });
      console.error(`⚠️  Order ${order.id} PARTIALLY delivered — needs manual follow-up.`);
    } else {
      db.updateOrder(order.id, {
        fulfillmentStatus: "failed",
        fulfillmentResults: result.results,
        needsManualReview: true,
      });
      console.error(`⚠️  Order ${order.id} fulfillment FAILED — customer paid but got no data. Needs refund or manual delivery.`);
    }
  } catch (err) {
    console.error(`Error fulfilling order ${order.id}:`, err.message);
    db.updateOrder(order.id, { fulfillmentStatus: "failed", fulfillmentError: err.message, needsManualReview: true });
  }
});

router.post("/webhooks/gladtidings", express.json(), (req, res) => {
  res.sendStatus(200);
  // Gladtidings' webhook payload includes an "ident" field and "Status".
  // This is logged for reconciliation; the main fulfillment logic above
  // already acts on the direct API response, so this is a secondary check.
  const { Status, ident, mobile_number, api_response } = req.body;
  console.log(`Gladtidings webhook: ${Status} — ${mobile_number} — ${ident} — ${api_response}`);
});

module.exports = router;
