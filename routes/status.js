/**
 * routes/status.js
 *
 * Serves a simple HTML page customers land on after paying. Since payment
 * confirmation and data delivery happen via webhook (which can take a few
 * seconds), this page polls the order's status every 2 seconds and updates
 * itself — so the customer sees "confirming payment" then either "delivered"
 * or "something went wrong" without needing to refresh manually.
 */

const express = require("express");
const db = require("../lib/db");

const router = express.Router();

router.get("/payment-complete", (req, res) => {
  const reference = req.query.ref || "";
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Order Status — MichaelStack Telecoms</title>
<style>
  body {
    background: #0A0E1A; color: #E8EAF0; font-family: -apple-system, sans-serif;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px;
  }
  .card {
    background: #121729; border: 1px solid #232B45; border-radius: 16px;
    padding: 32px 24px; max-width: 360px; width: 100%; text-align: center;
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
    let attempts = 0;

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
        document.getElementById('statusCard').innerHTML =
          '<div class="icon">⏳</div><h1>Still processing…</h1><p>This is taking longer than usual. If you were charged, your data will still arrive shortly, or contact support.</p>';
      }
    }

    function render(order) {
      const card = document.getElementById('statusCard');
      if (order.fulfillmentStatus === 'delivered') {
        card.innerHTML = '<div class="icon success">✓</div><h1 class="success">Data delivered!</h1><p>' + order.size + ' has been sent to ' + order.mobileNumber + '. Thank you for using MichaelStack Telecoms.</p>';
      } else if (order.fulfillmentStatus === 'failed' || order.fulfillmentStatus === 'partial') {
        card.innerHTML = '<div class="icon error">!</div><h1 class="error">Payment received, delivery delayed</h1><p>Your payment went through, but we hit a snag delivering your data. We\\'ve been notified and will resolve this shortly — no need to pay again.</p>';
      } else if (order.paymentStatus === 'paid') {
        card.innerHTML = '<div class="spinner"></div><h1>Payment confirmed — sending your data…</h1><p>Almost there.</p>';
      } else {
        card.innerHTML = '<div class="spinner"></div><h1>Confirming your payment…</h1><p>This usually takes just a few seconds.</p>';
      }
    }

    checkStatus();
  </script>
</body>
</html>`);
});

module.exports = router;
