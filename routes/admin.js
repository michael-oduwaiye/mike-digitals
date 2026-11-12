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
const {
  calculateProfit,
  calculateManualProfit,
} = require("../lib/profit");

const mongoose = require("mongoose");
const {
  InventoryItem,
  RepairJob,
  StockMovement,
  Sale,
  BusinessExpense,
  SequenceCounter,
} = require("../lib/phone-business");

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


router.get("/shop/overview", async (req, res) => {
  try {
    const now = new Date();
    const period = ["today", "week", "month"].includes(req.query.period)
      ? req.query.period
      : "today";

    // Get today's date in Lagos.
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);

    const dateParts = Object.fromEntries(
      parts.map(part => [part.type, part.value])
    );

    const year = Number(dateParts.year);
    const month = Number(dateParts.month);
    const day = Number(dateParts.day);

    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    // Convert Lagos midnight to UTC (Nigeria is UTC+1).
    const todayUtc = Date.UTC(year, month - 1, day) - 60 * 60 * 1000;

    let startUtc;
    let endUtc;

    if (period === "today") {
      startUtc = todayUtc;
      endUtc = todayUtc + MS_PER_DAY;
    } else if (period === "week") {
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const mondayOffset = (weekday + 6) % 7;

      startUtc = todayUtc - mondayOffset * MS_PER_DAY;
      endUtc = startUtc + 7 * MS_PER_DAY;
    } else {
      startUtc = Date.UTC(year, month - 1, 1) - 60 * 60 * 1000;
      endUtc = Date.UTC(year, month, 1) - 60 * 60 * 1000;
    }

    const startDate = new Date(startUtc);
    const endDate = new Date(endUtc);

    const inPeriod = date =>
      date && new Date(date) >= startDate && new Date(date) < endDate;

    const [
      repairs,
      sales,
      inventory,
      expenses,
    ] = await Promise.all([
      RepairJob.find({ isArchived: { $ne: true } }).lean(),
      Sale.find({}).lean(),
      InventoryItem.find({}).lean(),
      BusinessExpense.find({}).lean(),
    ]);

        // REPAIR INCOME: actual payments received during the selected period.
    const repairIncome = repairs
      .filter(job => job.status !== "cancelled")
      .reduce((total, job) => {
        const received = (job.payments || [])
          .filter(payment => inPeriod(payment.paidAt))
          .reduce(
            (sum, payment) => sum + Number(payment.amount || 0),
            0
          );

        return total + received;
      }, 0);

    // PRODUCT SALES: payments received during the selected period.
    // Legacy sales without categorySnapshot are treated as accessories.
    const periodSales = sales.filter(sale => inPeriod(sale.soldAt));

    const productCategorySales = {
      accessory: 0,
      "spare-part": 0,
      tool: 0,
    };

    const productSalesReceived = sales.reduce((total, sale) => {
      const paymentsReceived = (sale.payments || [])
        .filter(payment => inPeriod(payment.paidAt))
        .reduce(
          (sum, payment) => sum + Number(payment.amount || 0),
          0
        );

      if (paymentsReceived <= 0) return total;

      const items = sale.items || [];

      const categoryTotals = {
        accessory: 0,
        "spare-part": 0,
        tool: 0,
      };

      let eligibleSubtotal = 0;

      for (const item of items) {
        const category = item.categorySnapshot || "accessory";

        if (!Object.hasOwn(categoryTotals, category)) continue;

        const lineTotal = Number(item.lineTotal || 0);

        categoryTotals[category] += lineTotal;
        eligibleSubtotal += lineTotal;
      }

      if (eligibleSubtotal > 0) {
        const discount = Number(sale.discount || 0);
        const eligibleDiscount = Math.min(
          discount,
          eligibleSubtotal
        );

        for (const category of Object.keys(categoryTotals)) {
          const categoryRevenue = categoryTotals[category];

          const allocatedDiscount =
            eligibleSubtotal > 0
              ? eligibleDiscount * (categoryRevenue / eligibleSubtotal)
              : 0;

          const netCategoryRevenue = Math.max(
            0,
            categoryRevenue - allocatedDiscount
          );

          productCategorySales[category] +=
            paymentsReceived * (netCategoryRevenue / eligibleSubtotal);
        }
      }

      return total + paymentsReceived;
    }, 0);

    const accessorySales = Number(
      productCategorySales.accessory.toFixed(2)
    );

    const sparePartSales = Number(
      productCategorySales["spare-part"].toFixed(2)
    );

    const toolSales = Number(
      productCategorySales.tool.toFixed(2)
    );

    const totalProductSales = Number(
      (accessorySales + sparePartSales + toolSales).toFixed(2)
    );

    // COST OF PRODUCTS SOLD: recognised on the original sale date.
    const productCostOfGoodsSold = periodSales.reduce(
      (total, sale) => {
        const cost = (sale.items || []).reduce(
          (sum, item) =>
            sum +
            Number(item.quantity || 0) *
            Number(item.unitCostPrice || 0),
          0
        );

        return total + cost;
      },
      0
    );

    // COST OF SPARE PARTS USED IN REPAIRS:
    // recognised using the repair job's received date.
    const repairPartsCost = repairs
      .filter(job =>
        job.status !== "cancelled" &&
        inPeriod(job.receivedAt)
      )
      .reduce((total, job) => {
        const partsCost = (job.partsUsed || []).reduce(
          (sum, part) =>
            sum +
            Number(part.quantity || 0) *
            Number(part.unitCostPrice || 0),
          0
        );

        return total + partsCost;
      }, 0);

    // TOTAL COST OF ITEMS SOLD AND PARTS USED.
    const totalItemAndPartsCost =
      productCostOfGoodsSold + repairPartsCost;

    // SALES PAYMENTS RECEIVED.
    const accessoryIncomeReceived = productSalesReceived;

    // TOTAL INCOME: actual product and repair payments received.
    const totalIncome = totalProductSales + repairIncome;

    // OPERATING EXPENSES: count by expense date.
    const periodExpenses = expenses.filter(
      expense => inPeriod(expense.incurredAt)
    );

    const operatingExpenses = periodExpenses.reduce(
      (sum, expense) => sum + Number(expense.amount || 0),
      0
    );

    // NET PROFIT: income less item/parts costs and operating expenses.
    const netProfit =
      totalIncome -
      totalItemAndPartsCost -
      operatingExpenses;

    // OUTSTANDING BALANCES: all currently outstanding records.
    const outstandingRepairs = repairs.filter(
      job =>
        job.status !== "cancelled" &&
        Number(job.balance || 0) > 0
    );

    const outstandingSales = sales.filter(
      sale => Number(sale.balance || 0) > 0
    );

    const repairOutstanding = outstandingRepairs.reduce(
      (sum, job) => sum + Number(job.balance || 0),
      0
    );

    const accessoryOutstanding = outstandingSales.reduce(
      (sum, sale) => sum + Number(sale.balance || 0),
      0
    );

    // INVENTORY VALUE AND STOCK ALERTS.
    const inventoryValue = inventory.reduce(
      (sum, item) =>
        sum + Number(item.quantity || 0) * Number(item.costPrice || 0),
      0
    );

    const lowStockItems = inventory.filter(
      item => Number(item.quantity || 0) <= Number(item.lowStockThreshold || 0)
    );

    const outOfStockItems = inventory.filter(
      item => Number(item.quantity || 0) === 0
    );

    // REPAIR STATUS COUNTS.
    const activeStatuses = [
      "received",
      "diagnosing",
      "awaiting-parts",
      "in-progress",
      "repaired",
    ];

    const activeRepairs = repairs.filter(
      job => activeStatuses.includes(job.status)
    ).length;

    const awaitingParts = repairs.filter(
      job => job.status === "awaiting-parts"
    ).length;

    // DAILY PAYMENT REMINDERS: not restricted by the selected period.
    const paymentReminders = [
      ...outstandingRepairs.map(job => ({
        type: "repair",
        id: job._id,
        reference: job.jobNumber,
        customerName: job.customerName,
        customerPhone: job.customerPhone,
        totalAmount: Number(job.repairCost || 0),
        amountPaid: Number(job.amountPaid || 0),
        balance: Number(job.balance || 0),
        date: job.receivedAt,
      })),

      ...outstandingSales.map(sale => ({
        type: "accessory-sale",
        id: sale._id,
        reference: sale.saleNumber,
        customerName: sale.customerName || "Walk-in Customer",
        customerPhone: sale.customerPhone || "",
        totalAmount: Number(sale.totalAmount || 0),
        amountPaid: Number(sale.amountPaid || 0),
        balance: Number(sale.balance || 0),
        date: sale.soldAt,
      })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    // RECENT RECORDS.
    const recentRepairs = repairs
      .filter(job => inPeriod(job.receivedAt))
      .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
      .slice(0, 8);

    const recentSales = periodSales
      .slice()
      .sort((a, b) => new Date(b.soldAt) - new Date(a.soldAt))
      .slice(0, 8);

    const recentExpenses = periodExpenses
      .slice()
      .sort((a, b) => new Date(b.incurredAt) - new Date(a.incurredAt))
      .slice(0, 8);

    return res.json({
      success: true,
      period,
      dateRange: {
        start: startDate,
        end: endDate,
      },
      metrics: {
        repairIncome,
        accessorySales,
        sparePartSales,
        toolSales,
        totalProductSales,
        accessoryIncomeReceived,
        productCostOfGoodsSold,
        repairPartsCost,
        totalItemAndPartsCost,
        totalIncome,
        operatingExpenses,
        netProfit,
        repairOutstanding,
        accessoryOutstanding,
        totalOutstanding: repairOutstanding + accessoryOutstanding,
        inventoryValue,
        activeRepairs,
        awaitingParts,
        lowStockCount: lowStockItems.length,
        outOfStockCount: outOfStockItems.length,
      },
      paymentReminders,
      lowStockItems,
      recent: {
        repairs: recentRepairs,
        sales: recentSales,
        expenses: recentExpenses,
      },
    });
  } catch (error) {
    console.error("Shop overview error:", error);

    return res.status(500).json({
      error: "Could not load Shop Overview.",
    });
  }
});


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



// Record a VTU transaction completed outside the online storefront.
router.post("/orders/manual", async (req, res) => {
  try {
    const {
      customerName,
      mobileNumber,
      network,
      size,
      validity,
      sellingPrice: rawSellingPrice,
      wholesaleCost: rawWholesaleCost,
      paymentMethod,
      transactionDate,
      notes,
    } = req.body;

    const sellingPrice = Number(rawSellingPrice);
    const wholesaleCost = Number(rawWholesaleCost);

    // Validate required transaction details.
    if (
      typeof mobileNumber !== "string" ||
      !mobileNumber.trim() ||
      typeof network !== "string" ||
      !network.trim() ||
      typeof size !== "string" ||
      !size.trim()
    ) {
      return res.status(400).json({
        error: "Mobile number, network and data size are required.",
      });
    }

    if (
      !Number.isFinite(sellingPrice) ||
      sellingPrice <= 0 ||
      !Number.isFinite(wholesaleCost) ||
      wholesaleCost < 0
    ) {
      return res.status(400).json({
        error: "Enter valid selling and wholesale costs.",
      });
    }

    const allowedPaymentMethods = [
      "cash",
      "transfer",
      "pos",
      "other",
    ];

    if (!allowedPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        error: "Select a valid payment method.",
      });
    }

    const createdAt = transactionDate
      ? new Date(transactionDate)
      : new Date();

    if (Number.isNaN(createdAt.getTime())) {
      return res.status(400).json({
        error: "Enter a valid transaction date.",
      });
    }

    const profitDetails = calculateManualProfit({
      sellingPrice,
      wholesaleCost,
    });

    const orderId = new mongoose.Types.ObjectId().toString();

    const order = await db.createOrder({
      id: orderId,
      source: "manual",
      customerName: String(customerName || "").trim(),
      mobileNumber: mobileNumber.trim(),
      network: network.trim(),
      size: size.trim(),
      validity: String(validity || "").trim(),

      sellingPrice,
      wholesaleCost,

      paystackFee: profitDetails.paystackFee,
      amountAfterPaystack: profitDetails.amountAfterPaystack,
      walletFundingFee: profitDetails.walletFundingFee,
      totalFees: profitDetails.totalFees,
      profit: profitDetails.profit,
      profitMargin: profitDetails.profitMargin,

      paymentMethod,
      paymentStatus: "paid",
      fulfillmentStatus: "delivered",

      notes: String(notes || "").trim(),
      createdAt: createdAt.toISOString(),
      deliveredAt: createdAt.toISOString(),
    });

    res.setHeader("Cache-Control", "no-store");

    return res.status(201).json({
      success: true,
      message: "Manual VTU transaction recorded successfully.",
      order,
    });
  } catch (err) {
    console.error("Error recording manual VTU transaction:", err.message);

    return res.status(500).json({
      error: "Unable to record manual VTU transaction.",
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


function getLagosDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}


function getPeriodDates(period) {
  const today = getLagosDateString();
  let startDate;
  let endDate;

  if (period === "today") {
    startDate = today;
    endDate = shiftDate(today, 1);
  } else if (period === "week") {
    const day = new Date(`${today}T00:00:00Z`).getUTCDay();
    startDate = shiftDate(today, -((day + 6) % 7));
    endDate = shiftDate(startDate, 7);
  } else if (period === "month") {
    startDate = `${today.slice(0, 7)}-01`;

    const nextMonth = new Date(
      `${startDate}T00:00:00Z`
    );
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    endDate = nextMonth.toISOString().slice(0, 10);
  } else if (period === "annual") {
    startDate = `${today.slice(0, 4)}-01-01`;
    endDate = `${Number(today.slice(0, 4)) + 1}-01-01`;
  } else if (period === "all") {
    return { start: null, end: null };
  } else {
    return null;
  }

  return {
    start: new Date(`${startDate}T00:00:00+01:00`),
    end: new Date(`${endDate}T00:00:00+01:00`),
  };
}

router.get("/summary/transactions", async (req, res) => {
  try {
    const { period = "today", startDate, endDate } = req.query;
    let start;
    let end;

    if (period === "custom") {
      if (
        typeof startDate !== "string" ||
        typeof endDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
        startDate > endDate
      ) {
        return res.status(400).json({
          error: "Provide a valid custom start and end date.",
        });
      }

      start = new Date(`${startDate}T00:00:00+01:00`);
      end = new Date(
        `${shiftDate(endDate, 1)}T00:00:00+01:00`
      );
    } else {
      const dates = getPeriodDates(period);

      if (!dates) {
        return res.status(400).json({
          error: "Unsupported transaction summary period.",
        });
      }

      start = dates.start;
      end = dates.end;
    }

    const orders = await db.readAll();

    const delivered = orders.filter((order) => {
      if (order.fulfillmentStatus !== "delivered") return false;

      const createdAt = new Date(order.createdAt);
      if (Number.isNaN(createdAt.getTime())) return false;

      return (
        (!start || createdAt >= start) &&
        (!end || createdAt < end)
      );
    });

    const totalRevenue = delivered.reduce(
      (sum, order) => sum + Number(order.sellingPrice || 0),
      0
    );

    let totalProfit = 0;

    for (const order of delivered) {
      const sellingPrice = Number(order.sellingPrice);
      const wholesaleCost = Number(order.wholesaleCost);

      if (
        !Number.isFinite(sellingPrice) ||
        !Number.isFinite(wholesaleCost) ||
        sellingPrice < 0 ||
        wholesaleCost < 0
      ) {
        continue;
      }

      const { profit } =
        order.source === "manual"
          ? calculateManualProfit({
              sellingPrice,
              wholesaleCost,
              })
          : calculateProfit({
              sellingPrice,
              wholesaleCost,
              });

      totalProfit += profit;
    }

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      period,
      totalRevenue,
      totalProfit,
    });
  } catch (err) {
    console.error("Error generating transaction summary:", err.message);

    return res.status(500).json({
      error: "Unable to retrieve transaction summary.",
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

      const { profit } =
        order.source === "manual"
          ? calculateManualProfit({
              sellingPrice,
              wholesaleCost,
            })
          : calculateProfit({
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

/**
 * INVENTORY API
 *
 * All endpoints are protected by requireAdminSession.
 */

// GET /api/admin/inventory
// List inventory items, with optional search and low-stock filtering.
router.get("/inventory", async (req, res) => {
  try {
    const filter = {};
    const search = String(req.query.search || "").trim();

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      filter.$or = [
        { itemName: { $regex: escapedSearch, $options: "i" } },
        { variant: { $regex: escapedSearch, $options: "i" } },
      ];
    }

    if (req.query.category) {
      const allowedCategories = [
        "accessory",
        "spare-part",
        "tool",
        "other",
      ];

      if (!allowedCategories.includes(req.query.category)) {
        return res.status(400).json({ error: "Invalid inventory category." });
      }

      filter.category = req.query.category;
    }

    let items = await InventoryItem.find(filter).sort({ itemName: 1 }).lean();

    if (req.query.lowStock === "true") {
      items = items.filter(
        (item) => item.quantity <= item.lowStockThreshold
      );
    }

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      count: items.length,
      items: items.map((item) => ({
        ...item,
        lowStock: item.quantity <= item.lowStockThreshold,
      })),
    });
  } catch (err) {
    console.error("Error retrieving inventory:", err.message);

    return res.status(500).json({
      error: "Unable to retrieve inventory.",
    });
  }
});


// GET /api/admin/inventory/movements
// Retrieve stock movement history, newest first.
router.get("/inventory/movements", async (req, res) => {
  try {
    const filter = {};

    if (req.query.itemId) {
      if (!mongoose.isValidObjectId(req.query.itemId)) {
        return res.status(400).json({ error: "Invalid inventory item ID." });
      }

      filter.inventoryItemId = req.query.itemId;
    }

    if (req.query.movementType) {
      const allowedTypes = [
        "opening-stock",
        "purchase",
        "sale",
        "repair-usage",
        "return",
        "adjustment",
      ];

      if (!allowedTypes.includes(req.query.movementType)) {
        return res.status(400).json({ error: "Invalid movement type." });
      }

      filter.movementType = req.query.movementType;
    }

    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};

      if (req.query.startDate) {
        const start = new Date(req.query.startDate);

        if (Number.isNaN(start.getTime())) {
          return res.status(400).json({ error: "Invalid start date." });
        }

        filter.createdAt.$gte = start;
      }

      if (req.query.endDate) {
        const end = new Date(req.query.endDate);

        if (Number.isNaN(end.getTime())) {
          return res.status(400).json({ error: "Invalid end date." });
        }

        // Include the entire specified end date.
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const movements = await StockMovement.find(filter)
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean();

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      count: movements.length,
      movements,
    });
  } catch (err) {
    console.error("Error retrieving stock movements:", err.message);

    return res.status(500).json({
      error: "Unable to retrieve stock movement history.",
    });
  }
});


// POST /api/admin/inventory
// Create an inventory item and optionally record its opening stock.
router.post("/inventory", async (req, res) => {
  try {
    const body = req.body || {};

    const itemName =
      typeof body.itemName === "string" ? body.itemName.trim() : "";

    const category = body.category || "other";
    const variant =
      typeof body.variant === "string" ? body.variant.trim() : "";

    const quantity = body.quantity === undefined ? 0 : body.quantity;
    const costPrice = body.costPrice;
    const sellingPrice = body.sellingPrice;
    const lowStockThreshold =
      body.lowStockThreshold === undefined ? 5 : body.lowStockThreshold;

    const allowedCategories = [
      "accessory",
      "spare-part",
      "tool",
      "other",
    ];

    if (!itemName || itemName.length > 150) {
      return res.status(400).json({
        error: "Item name is required and must not exceed 150 characters.",
      });
    }

    if (!allowedCategories.includes(category)) {
      return res.status(400).json({ error: "Invalid inventory category." });
    }

    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 0
    ) {
      return res.status(400).json({
        error: "Opening quantity must be a non-negative whole number.",
      });
    }

    if (
      typeof costPrice !== "number" ||
      !Number.isFinite(costPrice) ||
      costPrice < 0 ||
      typeof sellingPrice !== "number" ||
      !Number.isFinite(sellingPrice) ||
      sellingPrice < 0
    ) {
      return res.status(400).json({
        error: "Cost price and selling price must be valid non-negative numbers.",
      });
    }

    if (
      typeof lowStockThreshold !== "number" ||
      !Number.isInteger(lowStockThreshold) ||
      lowStockThreshold < 0
    ) {
      return res.status(400).json({
        error: "Low-stock threshold must be a non-negative whole number.",
      });
    }

    if (variant.length > 150) {
      return res.status(400).json({
        error: "Variant must not exceed 150 characters.",
      });
    }

    const session = await mongoose.startSession();
    let saleNumber;
    let createdItem;

    try {
      await session.withTransaction(async () => {
        const [item] = await InventoryItem.create(
          [
            {
              itemName,
              category,
              variant,
              quantity,
              costPrice,
              sellingPrice,
              lowStockThreshold,
            },
          ],
          { session }
        );

        createdItem = item;

        if (quantity > 0) {
          await StockMovement.create(
            [
              {
                inventoryItemId: item._id,
                itemNameSnapshot: item.itemName,
                movementType: "opening-stock",
                quantityChange: quantity,
                unitCostPrice: costPrice,
                unitSellingPrice: sellingPrice,
                referenceType: "manual",
                notes: "Opening stock",
              },
            ],
            { session }
          );
        }
      });
    } finally {
      await session.endSession();
    }

    res.setHeader("Cache-Control", "no-store");

    return res.status(201).json({
      success: true,
      item: {
        ...createdItem.toObject(),
        lowStock: createdItem.quantity <= createdItem.lowStockThreshold,
      },
    });
  } catch (err) {
    console.error("Error creating inventory item:", err.message);

    return res.status(500).json({
      error: "Unable to create inventory item.",
    });
  }
});


// PATCH /api/admin/inventory/:id
// Edit item details without changing stock quantity.
router.patch("/inventory/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid inventory item ID." });
    }

    const allowedFields = [
      "itemName",
      "category",
      "variant",
      "costPrice",
      "sellingPrice",
      "lowStockThreshold",
    ];

    const submittedFields = Object.keys(body);

    if (
      submittedFields.length === 0 ||
      submittedFields.some((field) => !allowedFields.includes(field))
    ) {
      return res.status(400).json({
        error: "Submit only the supported inventory item fields.",
      });
    }

    const updates = {};

    if (Object.hasOwn(body, "itemName")) {
      if (
        typeof body.itemName !== "string" ||
        !body.itemName.trim() ||
        body.itemName.trim().length > 150
      ) {
        return res.status(400).json({ error: "Invalid item name." });
      }

      updates.itemName = body.itemName.trim();
    }

    if (Object.hasOwn(body, "category")) {
      if (
        !["accessory", "spare-part", "tool", "other"].includes(body.category)
      ) {
        return res.status(400).json({ error: "Invalid inventory category." });
      }

      updates.category = body.category;
    }

    if (Object.hasOwn(body, "variant")) {
      if (
        typeof body.variant !== "string" ||
        body.variant.trim().length > 150
      ) {
        return res.status(400).json({ error: "Invalid item variant." });
      }

      updates.variant = body.variant.trim();
    }

    for (const field of ["costPrice", "sellingPrice"]) {
      if (Object.hasOwn(body, field)) {
        if (
          typeof body[field] !== "number" ||
          !Number.isFinite(body[field]) ||
          body[field] < 0
        ) {
          return res.status(400).json({
            error: `${field} must be a valid non-negative number.`,
          });
        }

        updates[field] = body[field];
      }
    }

    if (Object.hasOwn(body, "lowStockThreshold")) {
      if (
        typeof body.lowStockThreshold !== "number" ||
        !Number.isInteger(body.lowStockThreshold) ||
        body.lowStockThreshold < 0
      ) {
        return res.status(400).json({
          error: "Low-stock threshold must be a non-negative whole number.",
        });
      }

      updates.lowStockThreshold = body.lowStockThreshold;
    }

    const item = await InventoryItem.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!item) {
      return res.status(404).json({ error: "Inventory item not found." });
    }

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      item: {
        ...item.toObject(),
        lowStock: item.quantity <= item.lowStockThreshold,
      },
    });
  } catch (err) {
    console.error("Error updating inventory item:", err.message);

    return res.status(500).json({
      error: "Unable to update inventory item.",
    });
  }
});


// POST /api/admin/inventory/:id/restock
// Record a stock purchase and update quantity and average cost price.
router.post("/inventory/:id/restock", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid inventory item ID." });
    }

    const { quantity, unitCostPrice } = body;
    const notes =
      typeof body.notes === "string" ? body.notes.trim() : "";

    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      return res.status(400).json({
        error: "Purchase quantity must be a positive whole number.",
      });
    }

    if (
      typeof unitCostPrice !== "number" ||
      !Number.isFinite(unitCostPrice) ||
      unitCostPrice < 0
    ) {
      return res.status(400).json({
        error: "Purchase unit cost must be a valid non-negative number.",
      });
    }

    if (notes.length > 500) {
      return res.status(400).json({
        error: "Notes must not exceed 500 characters.",
      });
    }

    const session = await mongoose.startSession();
    let updatedItem;

    try {
      await session.withTransaction(async () => {
        const item = await InventoryItem.findById(id).session(session);

        if (!item) {
          const error = new Error("INVENTORY_ITEM_NOT_FOUND");
          throw error;
        }

        const oldQuantity = item.quantity;
        const newQuantity = oldQuantity + quantity;

        if (!Number.isSafeInteger(newQuantity)) {
          throw new Error("STOCK_QUANTITY_OVERFLOW");
        }

        // Weighted-average cost after adding the new purchase.
        const newCostPrice =
          newQuantity === 0
            ? unitCostPrice
            : (
                oldQuantity * item.costPrice +
                quantity * unitCostPrice
              ) / newQuantity;

        item.quantity = newQuantity;
        item.costPrice = Number(newCostPrice.toFixed(2));

        await item.save({ session });

        await StockMovement.create(
          [
            {
              inventoryItemId: item._id,
              itemNameSnapshot: item.itemName,
              movementType: "purchase",
              quantityChange: quantity,
              unitCostPrice,
              unitSellingPrice: item.sellingPrice,
              referenceType: "purchase",
              notes: notes || "Stock replenishment",
            },
          ],
          { session }
        );

        updatedItem = item;
      });
    } finally {
      await session.endSession();
    }

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      item: {
        ...updatedItem.toObject(),
        lowStock:
          updatedItem.quantity <= updatedItem.lowStockThreshold,
      },
    });
  } catch (err) {
    if (err.message === "INVENTORY_ITEM_NOT_FOUND") {
      return res.status(404).json({ error: "Inventory item not found." });
    }

    if (err.message === "STOCK_QUANTITY_OVERFLOW") {
      return res.status(400).json({ error: "Stock quantity is too large." });
    }

    console.error("Error restocking inventory:", err.message);

    return res.status(500).json({
      error: "Unable to record stock purchase.",
    });
  }
});


// ==========================================
// REPAIR JOBS API
// ==========================================

const REPAIR_EDITABLE_FIELDS = [
  "customerName",
  "customerPhone",
  "deviceBrand",
  "deviceModel",
  "deviceModelNumber",
  "reportedFault",
  "diagnosis",
  "repairNotes",
  "status",
  "estimatedCost",
  "repairCost",
  "amountPaid",
  "warrantyDays",
  "customerComplaint",
  "internalNotes",
  "receivedAt",
];

const REPAIR_STATUSES = [
  "received",
  "diagnosing",
  "awaiting-parts",
  "in-progress",
  "repaired",
  "collected",
  "unrepairable",
  "cancelled"
];

const REPAIR_TEXT_LIMITS = {
  customerName: 150,
  customerPhone: 20,
  deviceBrand: 100,
  deviceModel: 150,
  deviceModelNumber: 150,
  reportedFault: 2000,
  diagnosis: 3000,
  repairNotes: 3000,
  customerComplaint: 2000,
  internalNotes: 3000,
};

function validateRepairFields(body, creating = false) {
  const submittedFields = Object.keys(body);

  if (submittedFields.length === 0) {
    return "Submit at least one field.";
  }

  const allowedFields = [
  ...REPAIR_EDITABLE_FIELDS,
  "partsUsed",
  ...(creating ? ["paymentMethod"] : []),
  ];

  if (submittedFields.some((field) => !allowedFields.includes(field))) {
    return "One or more submitted fields are not editable.";
  }

  for (const field of Object.keys(REPAIR_TEXT_LIMITS)) {
    if (!Object.hasOwn(body, field)) continue;

    const value = body[field];

    if (
      typeof value !== "string" ||
      value.trim().length > REPAIR_TEXT_LIMITS[field]
    ) {
      return `${field} must be text and must not exceed ${REPAIR_TEXT_LIMITS[field]} characters.`;
    }

    if (
      creating &&
      ["customerName", "customerPhone", "deviceBrand", "deviceModel", "reportedFault"].includes(field) &&
      !value.trim()
    ) {
      return `${field} is required.`;
    }
  }

  if (Object.hasOwn(body, "status")) {
    if (!REPAIR_STATUSES.includes(body.status)) {
      return "Invalid repair status.";
    }
  }

  for (const field of ["estimatedCost", "repairCost", "amountPaid"]) {
    if (!Object.hasOwn(body, field)) continue;

    if (
      typeof body[field] !== "number" ||
      !Number.isFinite(body[field]) ||
      body[field] < 0 ||
      body[field] > 100000000
    ) {
      return `${field} must be a valid amount between ₦0 and ₦100,000,000.`;
    }
  }


const validPaymentMethods = ["cash", "transfer", "pos", "other"];

if (
  Object.hasOwn(body, "paymentMethod") &&
  !validPaymentMethods.includes(body.paymentMethod)
) {
  return "Invalid payment method.";
}

if (
  creating &&
  Number(body.amountPaid || 0) > 0 &&
  !validPaymentMethods.includes(body.paymentMethod)
) {
  return "A valid payment method is required when an initial payment is received.";
}


  if (Object.hasOwn(body, "warrantyDays")) {
    if (
      !Number.isInteger(body.warrantyDays) ||
      body.warrantyDays < 0 ||
      body.warrantyDays > 3650
    ) {
      return "Warranty days must be a whole number between 0 and 3650.";
    }
  }

  if (Object.hasOwn(body, "receivedAt")) {
    const date = new Date(body.receivedAt);

    if (
      !body.receivedAt ||
      Number.isNaN(date.getTime())
    ) {
      return "receivedAt must be a valid date.";
    }
  }

  if (Object.hasOwn(body, "partsUsed")) {
    if (!Array.isArray(body.partsUsed)) {
      return "partsUsed must be an array.";
    }

    for (const part of body.partsUsed) {
      if (
        !part ||
        typeof part !== "object" ||
        !mongoose.isValidObjectId(part.inventoryItemId) ||
        !Number.isInteger(part.quantity) ||
        part.quantity < 1 ||
        part.quantity > 100000
      ) {
        return "Each part must contain a valid inventoryItemId and a positive whole-number quantity.";
      }
    }
  }

  return null;
}

function getRepairJobPrefix(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `MD-${values.day}-${values.month}-${values.year}`;
}

async function generateRepairJobNumber(session) {
  const prefix = getRepairJobPrefix();

  const existingJobs = await RepairJob.find({
    jobNumber: new RegExp(`^${prefix}-\\d+$`),
  })
    .select("jobNumber")
    .session(session)
    .lean();

  const highestNumber = existingJobs.reduce((highest, job) => {
    const match = job.jobNumber.match(/-(\d+)$/);

    return match
      ? Math.max(highest, Number(match[1]))
      : highest;
  }, 0);

  return `${prefix}-${highestNumber + 1}`;
}

async function prepareRepairParts(parts, session) {
  const combined = new Map();

  for (const part of parts || []) {
    const id = String(part.inventoryItemId);
    const existing = combined.get(id);

    if (existing) {
      existing.quantity += part.quantity;
    } else {
      combined.set(id, {
        inventoryItemId: id,
        quantity: part.quantity,
      });
    }
  }

  const prepared = [];

  for (const part of combined.values()) {
    if (!Number.isSafeInteger(part.quantity)) {
      throw new Error("INVALID_PART_QUANTITY");
    }

    const item = await InventoryItem.findById(part.inventoryItemId)
      .session(session);

    if (!item) {
      throw new Error("REPAIR_PART_NOT_FOUND");
    }

    prepared.push({
      inventoryItemId: item._id,
      itemNameSnapshot: item.itemName,
      quantity: part.quantity,
      unitCostPrice: item.costPrice,
    });
  }

  return prepared;
}

async function reverseRepairParts(job, session) {
  for (const part of job.partsUsed || []) {
    const item = await InventoryItem.findById(part.inventoryItemId)
      .session(session);

    if (!item) {
      throw new Error("REPAIR_PART_NOT_FOUND");
    }

    const updatedItem = await InventoryItem.findByIdAndUpdate(
      item._id,
      {
        $inc: {
          quantity: part.quantity,
        },
      },
      {
        new: true,
        session,
        runValidators: true,
      }
    );

    if (!updatedItem) {
      throw new Error("REPAIR_PART_NOT_FOUND");
    }

    await StockMovement.create(
      [
        {
          inventoryItemId: item._id,
          itemNameSnapshot: part.itemNameSnapshot,
          movementType: "return",
          quantityChange: part.quantity,
          unitCostPrice: part.unitCostPrice,
          unitSellingPrice: item.sellingPrice,
          referenceType: "repair",
          referenceId: job.jobNumber,
          notes: "Reversed previous repair parts usage during record edit.",
        },
      ],
      { session }
    );
  }
}

async function deductRepairParts(job, parts, session) {
  for (const part of parts) {
    const item = await InventoryItem.findOneAndUpdate(
      {
        _id: part.inventoryItemId,
        quantity: { $gte: part.quantity },
      },
      {
        $inc: {
          quantity: -part.quantity,
        },
      },
      {
        returnDocument: "after",
        session,
        runValidators: true,
      }
    );

    if (!item) {
      const exists = await InventoryItem.exists({
        _id: part.inventoryItemId,
      }).session(session);

      if (!exists) {
        throw new Error("REPAIR_PART_NOT_FOUND");
      }

      throw new Error("INSUFFICIENT_REPAIR_STOCK");
    }

    await StockMovement.create(
      [
        {
          inventoryItemId: item._id,
          itemNameSnapshot: item.itemName,
          movementType: "repair-usage",
          quantityChange: -part.quantity,
          unitCostPrice: part.unitCostPrice,
          unitSellingPrice: item.sellingPrice,
          referenceType: "repair",
          referenceId: job.jobNumber,
          notes: "Parts used for phone repair.",
        },
      ],
      { session }
    );
  }
}

function updateRepairFinancials(job) {
  job.balance = Math.max(
    0,
    Number(job.repairCost || 0) - Number(job.amountPaid || 0)
  );
}

function updateRepairWarranty(job) {
  const isCompleted = ["repaired", "collected"].includes(job.status);

  if (isCompleted) {
    if (!job.completedAt) {
      job.completedAt = new Date();
    }

    if (Number(job.warrantyDays || 0) > 0) {
      job.warrantyExpiresAt = new Date(
        job.completedAt.getTime() +
        job.warrantyDays * 24 * 60 * 60 * 1000
      );
    } else {
      job.warrantyExpiresAt = null;
    }
  } else {
    job.completedAt = null;
    job.warrantyExpiresAt = null;
  }

  if (job.status === "collected" && !job.collectedAt) {
    job.collectedAt = new Date();
  }
}

// POST /api/admin/repairs
// Create a repair job.
router.post("/repairs", async (req, res) => {
  const body = req.body || {};
  const validationError = validateRepairFields(body, true);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const { paymentMethod, ...repairFields } = body;

  const initialAmountPaid = Number(body.amountPaid || 0);

  const initialPayments = initialAmountPaid > 0
    ? [
        {
          amount: initialAmountPaid,
          paymentMethod,
          paidAt: new Date(),
        },
      ]
    : [];

  const receivedAt = body.receivedAt
    ? new Date(body.receivedAt)
    : new Date();

  const session = await mongoose.startSession();

  try {
    let createdJob;

    await session.withTransaction(async () => {
      const jobNumber = await generateRepairJobNumber(session);

      const partsUsed = await prepareRepairParts(
        body.partsUsed || [],
        session
      );

    const [job] = await RepairJob.create(
      [
        {
          ...repairFields,
          jobNumber,
          partsUsed,
          receivedAt,

          openingAmountPaid: 0,
          payments: initialPayments,
          amountPaid: initialAmountPaid,
        },
      ],
      { session }
    );

      updateRepairFinancials(job);
      updateRepairWarranty(job);

      await job.save({ session });

      await deductRepairParts(job, partsUsed, session);

      createdJob = job;
    });

    res.setHeader("Cache-Control", "no-store");

    return res.status(201).json({
      success: true,
      repair: createdJob,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        error: "A repair job number already exists. Please try again.",
      });
    }

    if (err.message === "REPAIR_PART_NOT_FOUND") {
      return res.status(400).json({
        error: "One of the selected spare parts does not exist.",
      });
    }

    if (err.message === "INSUFFICIENT_REPAIR_STOCK") {
      return res.status(400).json({
        error: "There is not enough stock for one or more selected parts.",
      });
    }

    if (err.message === "INVALID_PART_QUANTITY") {
      return res.status(400).json({
        error: "The combined quantity for a part is too large.",
      });
    }

    console.error("Error creating repair job:", err.message);

    return res.status(500).json({
      error: "Unable to create repair job.",
    });
  } finally {
    await session.endSession();
  }
});

// GET /api/admin/repairs
// List or search repair jobs.
router.get("/repairs", async (req, res) => {
  try {
    const filter = {
      isArchived: req.query.archived === "true"
        ? true
        : { $ne: true },
    };

    const search = String(req.query.search || "").trim();

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      filter.$or = [
        { jobNumber: { $regex: escaped, $options: "i" } },
        { customerName: { $regex: escaped, $options: "i" } },
        { customerPhone: { $regex: escaped, $options: "i" } },
        { deviceBrand: { $regex: escaped, $options: "i" } },
        { deviceModel: { $regex: escaped, $options: "i" } },
        { deviceModelNumber: { $regex: escaped, $options: "i" } },
      ];
    }

    if (req.query.status) {
      if (!REPAIR_STATUSES.includes(req.query.status)) {
        return res.status(400).json({
          error: "Invalid repair status.",
        });
      }

      filter.status = req.query.status;
    }

    const repairs = await RepairJob.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      count: repairs.length,
      repairs,
    });
  } catch (err) {
    console.error("Error listing repair jobs:", err.message);

    return res.status(500).json({
      error: "Unable to retrieve repair jobs.",
    });
  }
});

// GET /api/admin/repairs/:id
// Retrieve one repair job by MongoDB ID or job number.
router.get("/repairs/:id", async (req, res) => {
  try {
    const identifier = String(req.params.id).trim();

    const filter = mongoose.isValidObjectId(identifier)
      ? { _id: identifier }
      : { jobNumber: identifier };

    const repair = await RepairJob.findOne(filter).lean();

    if (!repair) {
      return res.status(404).json({
        error: "Repair job not found.",
      });
    }

    res.setHeader("Cache-Control", "no-store");

    return res.json({ repair });
  } catch (err) {
    console.error("Error retrieving repair job:", err.message);

    return res.status(500).json({
      error: "Unable to retrieve repair job.",
    });
  }
});

// Resolve a repair job by MongoDB ObjectId or human-readable job number.
function findRepairJobByIdentifier(identifier, session) {
  const query = mongoose.isValidObjectId(identifier)
    ? { _id: identifier }
    : { jobNumber: identifier };

  return RepairJob.findOne(query).session(session);
}


router.post("/repairs/:id/payments", async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};

  const amount = Number(body.amount);
  const validMethods = ["cash", "transfer", "pos", "other"];

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Enter a valid payment amount." });
  }

  if (!validMethods.includes(body.paymentMethod)) {
    return res.status(400).json({ error: "Invalid payment method." });
  }

  const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();

  if (Number.isNaN(paidAt.getTime())) {
    return res.status(400).json({ error: "Invalid payment date." });
  }

  const session = await mongoose.startSession();

  try {
    let updatedJob;

    await session.withTransaction(async () => {
      const job = await findRepairJobByIdentifier(id, session);

      if (!job) throw new Error("REPAIR_JOB_NOT_FOUND");
      if (job.isArchived) throw new Error("REPAIR_JOB_ARCHIVED");
      if (job.status === "cancelled") throw new Error("REPAIR_JOB_CANCELLED");

      if (amount > Number(job.balance || 0)) {
        throw new Error("PAYMENT_EXCEEDS_BALANCE");
      }

      const existingPayments = job.payments || [];

      const paymentsTotal = existingPayments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0
      );

      if (job.openingAmountPaid == null) {
        job.openingAmountPaid = Math.max(
          0,
          Number(job.amountPaid || 0) - paymentsTotal
        );
      }

      job.payments.push({
        amount,
        paymentMethod: body.paymentMethod,
        paidAt,
        reference: String(body.reference || "").trim(),
        notes: String(body.notes || "").trim(),
      });

      job.amountPaid =
        Number(job.openingAmountPaid || 0) +
        job.payments.reduce(
          (sum, payment) => sum + Number(payment.amount || 0),
          0
        );

      updateRepairFinancials(job);

      await job.save({ session });

      updatedJob = job;
    });

    return res.json({
      success: true,
      message: "Repair payment recorded successfully.",
      repair: updatedJob,
    });
  } catch (error) {
    const errors = {
      REPAIR_JOB_NOT_FOUND: [404, "Repair job not found."],
      REPAIR_JOB_ARCHIVED: [400, "This repair job is archived."],
      REPAIR_JOB_CANCELLED: [400, "Cannot record payment for a cancelled job."],
      PAYMENT_EXCEEDS_BALANCE: [400, "Payment cannot exceed the outstanding balance."],
    };

    const result = errors[error.message];

    if (result) {
      return res.status(result[0]).json({ error: result[1] });
    }

    console.error("Record repair payment error:", error);

    return res.status(500).json({
      error: "Could not record repair payment.",
    });
  } finally {
    await session.endSession();
  }
});


router.post("/sales/:id/payments", async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};

  const amount = Number(body.amount);
  const validMethods = ["cash", "transfer", "pos", "other"];

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid payment amount.",
    });
  }

  if (!validMethods.includes(body.paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: "Select a valid payment method.",
    });
  }

  const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();

  if (Number.isNaN(paidAt.getTime())) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid payment date.",
    });
  }

  const session = await mongoose.startSession();

  try {
    let updatedSale;

    await session.withTransaction(async () => {
      const saleFilter = mongoose.isValidObjectId(id)
        ? { _id: id }
        : { saleNumber: id };

      const sale = await Sale.findOne(saleFilter).session(session);

      if (!sale) {
        throw new Error("SALE_NOT_FOUND");
      }

      const currentBalance = Number(sale.balance || 0);

      if (currentBalance <= 0) {
        throw new Error("SALE_ALREADY_PAID");
      }

      if (amount > currentBalance) {
        throw new Error("SALE_PAYMENT_EXCEEDS_BALANCE");
      }

      sale.payments = sale.payments || [];

      const existingPaymentsTotal = sale.payments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0
      );

      // Preserve older payments whose dates were not recorded.
      if (sale.openingAmountPaid == null) {
        sale.openingAmountPaid = Math.max(
          0,
          Number(sale.amountPaid || 0) - existingPaymentsTotal
        );
      }

      sale.payments.push({
        amount,
        paymentMethod: body.paymentMethod,
        paidAt,
        reference: body.reference || "",
        notes: body.notes || "",
      });

      const paymentsTotal = sale.payments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0
      );

      sale.amountPaid = Number(
        (Number(sale.openingAmountPaid || 0) + paymentsTotal).toFixed(2)
      );

      sale.balance = Number(
        (Number(sale.totalAmount || 0) - sale.amountPaid).toFixed(2)
      );

      await sale.save({ session });

      updatedSale = sale;
    });

    return res.json({
      success: true,
      message: "Sale payment recorded successfully.",
      sale: updatedSale,
    });

  } catch (error) {
    const messages = {
      SALE_NOT_FOUND: "Sale not found.",
      SALE_ALREADY_PAID: "This sale has already been fully paid.",
      SALE_PAYMENT_EXCEEDS_BALANCE: "Payment cannot exceed the outstanding balance.",
    };

    const knownError = messages[error.message];

    if (knownError) {
      return res.status(error.message === "SALE_NOT_FOUND" ? 404 : 400).json({
        success: false,
        message: knownError,
      });
    }

    console.error("Record sale payment error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to record sale payment.",
    });

  } finally {
    await session.endSession();
  }
});


// PATCH /api/admin/repairs/:id
// Edit any permitted field in an existing repair record.
router.patch("/repairs/:id", async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const validationError = validateRepairFields(body);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  

  const session = await mongoose.startSession();

  try {
    let updatedJob;

    await session.withTransaction(async () => {
      const job = await findRepairJobByIdentifier(id, session);
      const previousStatus = job ? job.status : null;

      if (!job) {
        throw new Error("REPAIR_JOB_NOT_FOUND");
      }

      if (job.isArchived) {
        throw new Error("REPAIR_JOB_ARCHIVED");
      }

      if (Object.hasOwn(body, "status") && body.status === "cancelled") {
        throw new Error("USE_CANCELLATION_ENDPOINT");
      }

      if (job.status === "cancelled") {
        throw new Error("REPAIR_JOB_CANCELLED");
      }

      if (Object.hasOwn(body, "partsUsed")) {
        await reverseRepairParts(job, session);

        const newParts = await prepareRepairParts(
          body.partsUsed,
          session
        );

        await deductRepairParts(job, newParts, session);

        job.partsUsed = newParts;
      }

      for (const field of REPAIR_EDITABLE_FIELDS) {
        if (!Object.hasOwn(body, field)) continue;

        job[field] = field === "receivedAt"
          ? new Date(body[field])
          : typeof body[field] === "string"
            ? body[field].trim()
            : body[field];
      }

      updateRepairFinancials(job);

      const enteredCompletedStatus =
        ["repaired", "collected"].includes(job.status) &&
        !["repaired", "collected"].includes(previousStatus);

      if (enteredCompletedStatus) {
        job.completedAt = new Date();
      }

      updateRepairWarranty(job);

      await job.save({ session });

      updatedJob = job;
    });

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      repair: updatedJob,
    });
  } catch (err) {
    if (err.message === "REPAIR_JOB_NOT_FOUND") {
      return res.status(404).json({
        error: "Repair job not found.",
      });
    }

        if (err.message === "REPAIR_JOB_ARCHIVED") {
      return res.status(400).json({
        error: "Restore this repair record before editing it.",
      });
    }

    if (err.message === "USE_CANCELLATION_ENDPOINT") {
      return res.status(400).json({
        error: "Use the cancellation endpoint to cancel a repair job.",
      });
    }

    if (err.message === "REPAIR_JOB_CANCELLED") {
      return res.status(400).json({
        error: "Cancelled repair jobs cannot be edited.",
      });
    }

    if (err.message === "REPAIR_PART_NOT_FOUND") {
      return res.status(400).json({
        error: "One of the selected spare parts does not exist.",
      });
    }

    if (err.message === "INSUFFICIENT_REPAIR_STOCK") {
      return res.status(400).json({
        error: "There is not enough stock for one or more selected parts.",
      });
    }

    if (err.message === "INVALID_PART_QUANTITY") {
      return res.status(400).json({
        error: "The combined quantity for a part is too large.",
      });
    }

    console.error("Error updating repair job:", err.message);

    return res.status(500).json({
      error: "Unable to update repair job.",
    });
  } finally {
    await session.endSession();
  }
});

// POST /api/admin/repairs/:id/cancel
// Cancel a repair while preserving its complete history.
router.post("/repairs/:id/cancel", async (req, res) => {
  const identifier = String(req.params.id || "").trim();
  const reason = String(req.body?.reason || "").trim();

  if (!reason || reason.length > 1000) {
    return res.status(400).json({
      error: "A cancellation reason is required (maximum 1000 characters).",
    });
  }

  try {
    const job = await findRepairJobByIdentifier(identifier);

    if (!job) {
      return res.status(404).json({
        error: "Repair job not found.",
      });
    }

    if (job.isArchived) {
      return res.status(400).json({
        error: "Restore this repair record before cancelling it.",
      });
    }

    if (job.status === "cancelled") {
      return res.status(400).json({
        error: "This repair job is already cancelled.",
      });
    }

    if (job.status === "collected") {
      return res.status(400).json({
        error: "A collected repair job cannot be cancelled.",
      });
    }

    job.status = "cancelled";
    job.cancelledAt = new Date();
    job.cancellationReason = reason;

    await job.save();

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      message: "Repair job cancelled. Its history and stock records have been preserved.",
      repair: job,
    });
  } catch (err) {
    console.error("Error cancelling repair job:", err.message);

    return res.status(500).json({
      error: "Unable to cancel repair job.",
    });
  }
});

// POST /api/admin/repairs/:id/archive
// Archive a repair without deleting its history or changing stock.
router.post("/repairs/:id/archive", async (req, res) => {
  const identifier = String(req.params.id || "").trim();

  try {
    const job = await findRepairJobByIdentifier(identifier);

    if (!job) {
      return res.status(404).json({
        error: "Repair job not found.",
      });
    }

    if (job.isArchived) {
      return res.status(400).json({
        error: "This repair job is already archived.",
      });
    }

    job.isArchived = true;
    job.archivedAt = new Date();

    await job.save();

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      message: "Repair job archived successfully.",
      repair: job,
    });
  } catch (err) {
    console.error("Error archiving repair job:", err.message);

    return res.status(500).json({
      error: "Unable to archive repair job.",
    });
  }
});


// POST /api/admin/repairs/:id/restore
// Restore an archived repair to the active list.
router.post("/repairs/:id/restore", async (req, res) => {
  const identifier = String(req.params.id || "").trim();

  try {
    const job = await findRepairJobByIdentifier(identifier);

    if (!job) {
      return res.status(404).json({
        error: "Repair job not found.",
      });
    }

    if (!job.isArchived) {
      return res.status(400).json({
        error: "This repair job is not archived.",
      });
    }

    job.isArchived = false;
    job.archivedAt = null;

    await job.save();

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      message: "Repair job restored successfully.",
      repair: job,
    });
  } catch (err) {
    console.error("Error restoring repair job:", err.message);

    return res.status(500).json({
      error: "Unable to restore repair job.",
    });
  }
});


// DELETE /api/admin/repairs/:id
// Permanent deletion is disabled to preserve repair history.
router.delete("/repairs/:id", async (req, res) => {
  return res.status(405).json({
      error: "Permanent deletion is disabled. Archive this repair record instead.",
    });
  });

  
// ==========================================
// ACCESSORY SALES API
// ==========================================

function getBusinessReferencePrefix(date = new Date()) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `MD-${day}-${month}-${year}`;
}

async function generateSaleNumber() {
  const prefix = getBusinessReferencePrefix();
  const counterId = `sale:${prefix}`;

  const salePattern = new RegExp(`^${prefix}-S-(\\d+)$`);

  // Initialise the counter from existing sales if this is
  // the first time the counter is being used for this date.
  const counterExists = await SequenceCounter.exists({
    _id: counterId,
  });

  if (!counterExists) {
    const existingSales = await Sale.find({
      saleNumber: salePattern,
    })
      .select("saleNumber")
      .lean();

    const highestExistingNumber = existingSales.reduce(
      (highest, sale) => {
        const match = sale.saleNumber.match(salePattern);

        if (!match) return highest;

        const number = Number(match[1]);

        return Number.isSafeInteger(number)
          ? Math.max(highest, number)
          : highest;
      },
      0
    );

    try {
      await SequenceCounter.updateOne(
        { _id: counterId },
        {
          $setOnInsert: {
            sequence: highestExistingNumber,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      // Another request may have created the counter first.
      // Ignore only that duplicate-key race.
      if (error.code !== 11000) {
        throw error;
      }
    }
  }

  // Atomically allocate the next number.
  const counter = await SequenceCounter.findOneAndUpdate(
    { _id: counterId },
    { $inc: { sequence: 1 } },
    {
      returnDocument: "after",
      upsert: true,
    }
  );

  if (!counter || !Number.isSafeInteger(counter.sequence)) {
    throw new Error("SALE_NUMBER_GENERATION_FAILED");
  }

  return `${prefix}-S-${counter.sequence}`;
}


// POST /api/admin/sales
// Create a sale and deduct stock atomically.
router.post("/sales", async (req, res) => {
  const body = req.body || {};

  try {
    const customerName =
      typeof body.customerName === "string"
        ? body.customerName.trim()
        : "";

    const customerPhone =
      typeof body.customerPhone === "string"
        ? body.customerPhone.trim()
        : "";

    const notes =
      typeof body.notes === "string" ? body.notes.trim() : "";

    const paymentMethod = body.paymentMethod || "cash";

    if (customerName.length > 150 || customerPhone.length > 20) {
      return res.status(400).json({
        error: "Customer details exceed the allowed length.",
      });
    }

    if (notes.length > 1000) {
      return res.status(400).json({
        error: "Notes must not exceed 1000 characters.",
      });
    }

    if (!["cash", "transfer", "pos", "other"].includes(paymentMethod)) {
      return res.status(400).json({
        error: "Invalid payment method.",
      });
    }

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({
        error: "A sale must contain at least one item.",
      });
    }

    if (body.items.length > 50) {
      return res.status(400).json({
        error: "A sale cannot contain more than 50 item entries.",
      });
    }

    const discount =
      body.discount === undefined ? 0 : body.discount;

    const amountPaid =
      body.amountPaid === undefined ? null : body.amountPaid;

    if (
      typeof discount !== "number" ||
      !Number.isFinite(discount) ||
      discount < 0
    ) {
      return res.status(400).json({
        error: "Discount must be a valid non-negative number.",
      });
    }

    if (
      amountPaid !== null &&
      (
        typeof amountPaid !== "number" ||
        !Number.isFinite(amountPaid) ||
        amountPaid < 0
      )
    ) {
      return res.status(400).json({
        error: "Amount paid must be a valid non-negative number.",
      });
    }

    // Combine duplicate inventory IDs before processing.
    const quantities = new Map();

    for (const entry of body.items) {
      if (
        !entry ||
        !mongoose.isValidObjectId(entry.inventoryItemId) ||
        !Number.isSafeInteger(entry.quantity) ||
        entry.quantity <= 0
      ) {
        return res.status(400).json({
          error: "Each item requires a valid inventory ID and positive whole-number quantity.",
        });
      }

      const id = String(entry.inventoryItemId);
      const combinedQuantity =
        (quantities.get(id) || 0) + entry.quantity;

      if (!Number.isSafeInteger(combinedQuantity)) {
        return res.status(400).json({
          error: "Sale quantity is too large.",
        });
      }

      quantities.set(id, combinedQuantity);
    }

      // Allocate a unique sale number before starting the stock transaction.
      // Failed transactions may leave a skipped number, which is acceptable.
      const saleNumber = await generateSaleNumber();

      const session = await mongoose.startSession();
      let createdSale;

      try {
        await session.withTransaction(async () => {
          const saleItems = [];
          let subtotal = 0;

        for (const [inventoryItemId, quantity] of quantities) {
          // Atomic deduction prevents selling stock that is no longer available.
          const item = await InventoryItem.findOneAndUpdate(
            {
              _id: inventoryItemId,
              quantity: { $gte: quantity },
            },
            {
              $inc: { quantity: -quantity },
            },
            {
              returnDocument: "after",
              session,
            }
          );

          if (!item) {
            const error = new Error("SALE_STOCK_UNAVAILABLE");
            error.inventoryItemId = inventoryItemId;
            throw error;
          }

          const unitSellingPrice = item.sellingPrice;
          const unitCostPrice = item.costPrice;
          const lineTotal = Number(
            (quantity * unitSellingPrice).toFixed(2)
          );

          subtotal = Number((subtotal + lineTotal).toFixed(2));

          saleItems.push({
            inventoryItemId: item._id,
            itemNameSnapshot: item.itemName,
            categorySnapshot: item.category,
            quantity,
            unitSellingPrice,
            unitCostPrice,
            lineTotal,
          });

          await StockMovement.create(
            [
              {
                inventoryItemId: item._id,
                itemNameSnapshot: item.itemName,
                movementType: "sale",
                quantityChange: -quantity,
                unitCostPrice,
                unitSellingPrice,
                referenceType: "sale",
                referenceId: saleNumber,
                notes: `Product sale (${item.category})`,
              },
            ],
            { session }
          );
        }

        if (discount > subtotal) {
          throw new Error("SALE_DISCOUNT_EXCEEDS_TOTAL");
        }

        const totalAmount = Number((subtotal - discount).toFixed(2));
    const paid = amountPaid === null ? totalAmount : amountPaid;

    if (paid > totalAmount) {
      throw new Error("SALE_PAYMENT_EXCEEDS_TOTAL");
    }

    const balance = Number((totalAmount - paid).toFixed(2));
    

    const soldAt = new Date();

    const initialPayments = paid > 0
      ? [
          {
            amount: paid,
            paymentMethod,
            paidAt: soldAt,
          },
        ]
      : [];

    const [sale] = await Sale.create(
      [
        {
          saleNumber,
          customerName,
          customerPhone,
          items: saleItems,
          subtotal,
          discount,
          totalAmount,

          openingAmountPaid: 0,
          payments: initialPayments,

          amountPaid: paid,
          balance,
          paymentMethod,
          notes,
          soldAt,
        },
      ],
      { session }
    );

        createdSale = sale;
      });
    } finally {
      await session.endSession();
    }

    res.setHeader("Cache-Control", "no-store");

    return res.status(201).json({
      success: true,
      message: "Sale recorded successfully.",
      sale: createdSale,
    });
  } catch (err) {
    if (err.message === "SALE_STOCK_UNAVAILABLE") {
      return res.status(400).json({
        error: "Insufficient stock, or the inventory item is unavailable.",
        inventoryItemId: err.inventoryItemId,
      });
    }

    if (err.message === "SALE_DISCOUNT_EXCEEDS_TOTAL") {
      return res.status(400).json({
        error: "Discount cannot exceed the sale subtotal.",
      });
    }

    if (err.message === "SALE_PAYMENT_EXCEEDS_TOTAL") {
      return res.status(400).json({
        error: "Amount paid cannot exceed the sale total.",
      });
    }

    console.error("Error recording sale:", err.message);

    return res.status(500).json({
      error: "Unable to record product sale.",
    });
  }
});


// GET /api/admin/sales
// Retrieve sales, with optional date and search filters.
router.get("/sales", async (req, res) => {
  try {
    const filter = {};

    if (req.query.from || req.query.to) {
      filter.soldAt = {};

      if (req.query.from) {
        const from = new Date(req.query.from);

        if (Number.isNaN(from.getTime())) {
          return res.status(400).json({
            error: "Invalid start date.",
          });
        }

        filter.soldAt.$gte = from;
      }

      if (req.query.to) {
        const to = new Date(req.query.to);

        if (Number.isNaN(to.getTime())) {
          return res.status(400).json({
            error: "Invalid end date.",
          });
        }

        to.setHours(23, 59, 59, 999);
        filter.soldAt.$lte = to;
      }
    }

    if (req.query.search) {
      const search = String(req.query.search).trim();

      if (search.length > 100) {
        return res.status(400).json({
          error: "Search term is too long.",
        });
      }

      filter.$or = [
        { saleNumber: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
        { customerPhone: { $regex: search, $options: "i" } },
      ];
    }

    const sales = await Sale.find(filter)
      .sort({ soldAt: -1 })
      .limit(200)
      .lean();

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      count: sales.length,
      sales,
    });
  } catch (err) {
    console.error("Error retrieving sales:", err.message);

    return res.status(500).json({
      error: "Unable to retrieve sales.",
    });
  }
});



// ==========================================
// BUSINESS EXPENSES API
// ==========================================

const EXPENSE_CATEGORIES = [
  "rent",
  "electricity",
  "internet",
  "transport",
  "maintenance",
  "staff",
  "marketing",
  "bank-charges",
  "other",
];

async function generateExpenseNumber(session) {
  const prefix = getBusinessReferencePrefix();

  const latestExpense = await BusinessExpense.findOne({
    expenseNumber: new RegExp(`^${prefix}-E-\\d+$`),
  })
    .sort({ expenseNumber: -1 })
    .session(session);

  const nextNumber = latestExpense
    ? Number(latestExpense.expenseNumber.split("-E-").pop()) + 1
    : 1;

  return `${prefix}-E-${nextNumber}`;
}


// POST /api/admin/expenses
// Record a business operating expense.
router.post("/expenses", async (req, res) => {
  try {
    const body = req.body || {};

    const category =
      typeof body.category === "string"
        ? body.category.trim()
        : "";

    const description =
      typeof body.description === "string"
        ? body.description.trim()
        : "";

    const notes =
      typeof body.notes === "string" ? body.notes.trim() : "";

    const paymentMethod = body.paymentMethod || "cash";

    const amount = body.amount;

    const incurredAt =
      body.incurredAt === undefined
        ? new Date()
        : new Date(body.incurredAt);

    if (!EXPENSE_CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: "Invalid expense category.",
        allowedCategories: EXPENSE_CATEGORIES,
      });
    }

    if (!description || description.length > 500) {
      return res.status(400).json({
        error: "Description is required and must not exceed 500 characters.",
      });
    }

    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        error: "Expense amount must be a positive number.",
      });
    }

    if (!["cash", "transfer", "pos", "other"].includes(paymentMethod)) {
      return res.status(400).json({
        error: "Invalid payment method.",
      });
    }

    if (notes.length > 1000) {
      return res.status(400).json({
        error: "Notes must not exceed 1000 characters.",
      });
    }

    if (Number.isNaN(incurredAt.getTime())) {
      return res.status(400).json({
        error: "Invalid expense date.",
      });
    }

    const session = await mongoose.startSession();
    let createdExpense;

    try {
      await session.withTransaction(async () => {
        const expenseNumber = await generateExpenseNumber(session);

        const [expense] = await BusinessExpense.create(
          [
            {
              expenseNumber,
              category,
              description,
              amount: Number(amount.toFixed(2)),
              paymentMethod,
              incurredAt,
              notes,
            },
          ],
          { session }
        );

        createdExpense = expense;
      });
    } finally {
      await session.endSession();
    }

    res.setHeader("Cache-Control", "no-store");

    return res.status(201).json({
      success: true,
      message: "Business expense recorded successfully.",
      expense: createdExpense,
    });
  } catch (err) {
    console.error("Error recording business expense:", err.message);

    return res.status(500).json({
      error: "Unable to record business expense.",
    });
  }
});


// GET /api/admin/expenses
// Retrieve expenses with optional date and category filters.
router.get("/expenses", async (req, res) => {
  try {
    const filter = {};

    if (req.query.category) {
      const category = String(req.query.category).trim();

      if (!EXPENSE_CATEGORIES.includes(category)) {
        return res.status(400).json({
          error: "Invalid expense category.",
        });
      }

      filter.category = category;
    }

    if (req.query.from || req.query.to) {
      filter.incurredAt = {};

      if (req.query.from) {
        const from = new Date(req.query.from);

        if (Number.isNaN(from.getTime())) {
          return res.status(400).json({
            error: "Invalid start date.",
          });
        }

        filter.incurredAt.$gte = from;
      }

      if (req.query.to) {
        const to = new Date(req.query.to);

        if (Number.isNaN(to.getTime())) {
          return res.status(400).json({
            error: "Invalid end date.",
          });
        }

        to.setHours(23, 59, 59, 999);
        filter.incurredAt.$lte = to;
      }
    }

    const expenses = await BusinessExpense.find(filter)
      .sort({ incurredAt: -1 })
      .limit(200)
      .lean();

    const totalAmount = expenses.reduce(
      (sum, expense) => sum + Number(expense.amount || 0),
      0
    );

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      count: expenses.length,
      totalAmount,
      expenses,
    });
  } catch (err) {
    console.error("Error retrieving business expenses:", err.message);

    return res.status(500).json({
      error: "Unable to retrieve business expenses.",
    });
  }
});


module.exports = router;
