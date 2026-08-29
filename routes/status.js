/**
 * routes/status.js
 *
 * Serves the page customers land on after paying. Polls the order's status
 * every 2 seconds and updates itself — no manual refresh needed. Every final
 * state (delivered, failed, partial) gives the customer a clear next step:
 * return to the store, or get help via WhatsApp.
 */

const express = require("express");
const db = require("../lib/db");

const router = express.Router();

// Update this if your WhatsApp support number changes.
const WHATSAPP_NUMBER = "2347040744752";

router.get("/payment-complete", (req, res) => {
  const reference = req.query.ref || "";
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Order Status — Mike Digitals</title>
<style>
  body {
    background: #0A0E1A; color: #E8EAF0; font-family: -apple-system, sans-serif;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px;
  }
  .card {
    background: #121729; border: 1px solid #232B45; border-radius: 16px;
    padding: 32px 24px; max-width: 380px; width: 100%; text-align: center;
  }
  .spinner {
    width: 40px; height: 40px; border: 3px solid #232B45; border-top-color: #FFB627;
    border-radius: 50%; margin: 0 auto 20px; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .icon { font-size: 40px; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { color: #8B93A7; font-size: 14px; line-height: 1.5; margin: 0; }
  .success { color: #3DDC97; }
  .error { color: #FF6B6B; }
  .reference {
    font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #4E5670;
    margin-top: 16px; padding-top: 16px; border-top: 1px solid #232B45;
  }
  .note {
    font-size: 12.5px; color: #8B93A7; margin-top: 10px; line-height: 1.5;
  }
  .btn-row { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
  .btn-primary, .btn-secondary {
    display: block; text-decoration: none; font-weight: 700; padding: 13px; border-radius: 10px; font-size: 14px;
    font-family: -apple-system, sans-serif; border: none; cursor: pointer;
  }
  .btn-primary { background: #FFB627; color: #1A1200; }
  .btn-secondary { background: transparent; color: #E8EAF0; border: 1px solid #232B45; }
</style>
</head>
<body>
  <div class="card" id="statusCard">
    <div class="spinner"></div>
    <h1>Confirming your payment…</h1>
    <p>This usually takes just a few seconds.</p>
  </div>

  <script>
    const reference = ${JSON.stringify(reference)};
    const whatsappNumber = ${JSON.stringify(WHATSAPP_NUMBER)};
    let attempts = 0;

    function whatsappLink(message) {
      return 'https://wa.me/' + whatsappNumber + '?text=' + encodeURIComponent(message);
    }

    function referenceBlock() {
      return reference ? '<div class="reference">Reference: ' + reference + '</div>' : '';
    }

    async function checkStatus() {
      attempts++;
      try {
        const res = await fetch('/api/orders/by-reference/' + encodeURIComponent(reference));
        if (res.ok) {
          const order = await res.json();
          render(order);
          if (order.fulfillmentStatus === 'delivered') return;
          if (order.fulfillmentStatus === 'failed' || order.fulfillmentStatus === 'partial') return;
        }
      } catch (e) {}

      if (attempts < 20) {
        setTimeout(checkStatus, 2000);
      } else {
        const card = document.getElementById('statusCard');
        card.innerHTML =
          '<div class="icon">⏳</div>' +
          '<h1>Still processing…</h1>' +
          '<p>This is taking longer than usual. If you were charged, your data will still arrive shortly.</p>' +
          '<div class="btn-row">' +
            '<a href="/" class="btn-primary">Return to Store</a>' +
            '<a href="' + whatsappLink('Hello Mike Digitals, my payment (ref: ' + reference + ') is still processing after a while. Please check on it.') + '" class="btn-secondary" target="_blank">Chat on WhatsApp</a>' +
          '</div>' +
          referenceBlock();
      }
    }

    function render(order) {
      const card = document.getElementById('statusCard');

      if (order.fulfillmentStatus === 'delivered') {
        card.innerHTML =
          '<div class="icon success">🎉</div>' +
          '<h1 class="success">Payment Successful</h1>' +
          '<p>' + order.size + ' has been delivered to ' + order.mobileNumber + '.<br>Thank you for choosing Mike Digitals.</p>' +
          '<div class="btn-row">' +
            '<a href="/" class="btn-primary">Buy Another Data Plan</a>' +
          '</div>' +
          referenceBlock();

      } else if (order.fulfillmentStatus === 'failed' || order.fulfillmentStatus === 'partial') {
        card.innerHTML =
          '<div class="icon error">❗</div>' +
          '<h1 class="error">Payment received, delivery delayed</h1>' +
          '<p>Your payment went through successfully. We\\'re currently resolving a delivery issue on our end — you do not need to pay again.</p>' +
          '<div class="btn-row">' +
            '<a href="/" class="btn-primary">Return to Store</a>' +
            '<a href="' + whatsappLink('Hello Mike Digitals, my payment was successful (ref: ' + reference + ') but my order has not been delivered yet.') + '" class="btn-secondary" target="_blank">Chat on WhatsApp</a>' +
          '</div>' +
          referenceBlock();

      } else if (order.paymentStatus === 'paid') {
        card.innerHTML =
          '<div class="spinner"></div><h1>Payment confirmed — sending your data…</h1><p>Almost there.</p>' +
          referenceBlock();

      } else {
        card.innerHTML =
          '<div class="spinner"></div><h1>Confirming your payment…</h1><p>This usually takes just a few seconds.</p>' +
          referenceBlock();
      }
    }

    checkStatus();
  </script>
</body>
</html>`);
});

module.exports = router;

