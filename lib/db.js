
/**
 * lib/db.js
 *
 * MongoDB-backed order storage using Mongoose (a library that lets us work
 * with MongoDB using JavaScript objects instead of writing raw database
 * queries). Replaces the old JSON-file storage, which was wiped on every
 * Render redeploy since Render's filesystem doesn't persist file changes.
 *
 * Every other file in this project only talks to db.js, not to Mongoose
 * directly — so this is the only file that needed to change for the
 * database swap.
 */

const mongoose = require("mongoose");
const { PLANS, totalWholesaleCost } = require("../config/plans");

// "schema" = the shape/structure we expect an order document to have.
// strict: false means MongoDB will still accept any extra fields your
// code sends beyond what's listed here — this avoids breaking anything
// if an order object has fields not explicitly defined below.
const orderSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    paystackReference: { type: String },
    mobileNumber: { type: String },
    planId: { type: String },
    status: { type: String },
  },
  { strict: false, timestamps: true }
);
// timestamps: true automatically adds and manages createdAt/updatedAt fields.

const Order = mongoose.model("Order", orderSchema);

// Storefront plan records.
// These contain sale and display information, not Gladtidings provider IDs.
const planSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    network: { type: String, required: true },
    size: { type: String, required: true },
    validity: { type: String, required: true },
    sellingPrice: { type: Number, required: true, min: 0 },
    wholesaleCost: { type: Number, required: true, min: 0 },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Plan = mongoose.model("Plan", planSchema);

async function readAll() {
  return Order.find({}).lean();
  // .lean() returns plain JavaScript objects instead of Mongoose documents —
  // faster, and matches the plain-object shape the rest of your code expects.
}

async function createOrder(order) {
  const created = await Order.create(order);
  return created.toObject();
}

async function findByReference(paystackReference) {
  return Order.findOne({ paystackReference }).lean();
}

async function findById(orderId) {
  return Order.findOne({ id: orderId }).lean();
}

async function updateOrder(orderId, updates) {
  const updated = await Order.findOneAndUpdate(
    { id: orderId },
    { ...updates, updatedAt: new Date().toISOString() },
    { new: true } // return the updated document, not the old one
  ).lean();
  return updated;
}

// Read plans for the storefront or admin dashboard.
// Use { enabledOnly: true } when retrieving plans customers can purchase.
async function readPlans({ enabledOnly = false } = {}) {
  const filter = enabledOnly ? { enabled: true } : {};

  return Plan.find(filter)
    .sort({ network: 1, createdAt: 1 })
    .lean();
}

// Find a single plan using its stable plan ID.
async function findPlanById(planId) {
  return Plan.findOne({ id: planId }).lean();
}

// Create a plan record.
// The caller must validate the submitted data before calling this function.
async function createPlan(plan) {
  const created = await Plan.create(plan);
  return created.toObject();
}

// Update a plan without allowing its stable ID or other fields to be changed.
async function updatePlan(planId, updates) {
  const allowedFields = [
    "network",
    "size",
    "validity",
    "sellingPrice",
    "wholesaleCost",
    "enabled",
  ];

  const safeUpdates = Object.fromEntries(
    Object.entries(updates).filter(([key]) => allowedFields.includes(key))
  );

  if (Object.keys(safeUpdates).length === 0) {
    return findPlanById(planId);
  }

  return Plan.findOneAndUpdate(
    { id: planId },
    safeUpdates,
    {
      new: true,
      runValidators: true,
    }
  ).lean();
}

// Add any plans from config/plans.js that are missing from MongoDB.
// Existing database records are not overwritten, so changes made later
// through the admin dashboard will be preserved on subsequent startup runs.
//
// Only public plan information and the wholesale cost are stored here.
// Gladtidings fulfillment IDs remain in config/plans.js.
async function seedPlansFromConfig() {
  if (!Array.isArray(PLANS) || PLANS.length === 0) {
    return { added: 0 };
  }

  const operations = PLANS.map((plan) => ({
    updateOne: {
      filter: { id: plan.id },
      update: {
        $setOnInsert: {
          id: plan.id,
          network: plan.network,
          size: plan.size,
          validity: plan.validity,
          sellingPrice: plan.sellingPrice,
          wholesaleCost: totalWholesaleCost(plan),
          enabled: true,
        },
      },
      upsert: true,
    },
  }));

  const result = await Plan.bulkWrite(operations, { ordered: false });

  return {
    added: result.upsertedCount || 0,
  };
}

module.exports = {
  // Existing order functions — preserved.
  readAll,
  createOrder,
  findByReference,
  findById,
  updateOrder,

  // New plan functions.
  readPlans,
  findPlanById,
  createPlan,
  updatePlan,
  seedPlansFromConfig,
};
