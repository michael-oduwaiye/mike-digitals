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

module.exports = {
  readAll,
  createOrder,
  findByReference,
  findById,
  updateOrder,
};