/**
 * routes/whatsapp.js
 *
 * WhatsApp webhook receiver (Meta Cloud API).
 *
 * GET  /webhooks/whatsapp  — Meta's one-time verification handshake. Meta
 *      sends hub.mode, hub.verify_token, hub.challenge as query params; we
 *      echo back hub.challenge only if the token matches ours.
 * POST /webhooks/whatsapp  — Meta sends every incoming customer message
 *      here. For Phase 1, we just log it so we can confirm the connection
 *      works. Order/payment logic comes in a later phase.
 */

const express = require("express");

const router = express.Router();

router.get("/webhooks/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("✅ WhatsApp webhook verified by Meta");
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
  res.sendStatus(400);
});

router.post("/webhooks/whatsapp", express.json(), (req, res) => {
  console.log("Incoming WhatsApp webhook:");
  console.log(JSON.stringify(req.body, null, 2));
  res.sendStatus(200); // acknowledge quickly, same pattern as webhooks.js
});

module.exports = router;