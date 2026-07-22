/**
 * server.js
 *
 * Main entry point. Run with: npm start
 *
 * Routes:
 *   POST /api/orders              - customer creates an order (storefront calls this)
 *   GET  /api/orders/:id          - check an order's status
 *   POST /webhooks/paystack       - Paystack payment confirmation
 *   POST /webhooks/gladtidings    - Gladtidings delivery confirmation
 *   GET  /api/admin/*             - admin dashboard data (password protected)
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const ordersRouter = require("./routes/orders");
const webhooksRouter = require("./routes/webhooks");
const adminRouter = require("./routes/admin");
const statusRouter = require("./routes/status");

const app = express();

app.use(cors());
app.use(express.static("public"));

// NOTE: webhooks.js applies its own express.json() with raw-body capture
// (needed for Paystack signature verification), so we don't apply a global
// json() before it. Apply it here for all OTHER routes instead.
app.use("/api", express.json());

app.use("/api", ordersRouter);
app.use("/", webhooksRouter);
app.use("/", statusRouter);
app.use("/api/admin", adminRouter);



app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MichaelStack Telecoms backend running on port ${PORT}`);
  if (!process.env.GLADTIDINGS_TOKEN) {
    console.warn("⚠️  GLADTIDINGS_TOKEN is not set — data delivery will fail until you add it to .env");
  }
  if (!process.env.PAYSTACK_SECRET_KEY) {
    console.warn("⚠️  PAYSTACK_SECRET_KEY is not set — payments will fail until you add it to .env");
  }
});
