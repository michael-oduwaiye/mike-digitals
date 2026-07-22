/**
 * lib/db.js
 *
 * A deliberately simple JSON-file database. At the scale of a small reseller
 * business (dozens to low hundreds of orders per day), a real database is
 * overkill to start with. This stores every order as a record in
 * data/orders.json, with basic read/write helpers.
 *
 * If the business grows a lot (thousands of orders/day), swap this file for
 * a real database (Postgres/SQLite) — every other file in this project only
 * talks to db.js, not to the raw file, so that swap would be contained here.
 */

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "orders.json");

function ensureDbFile() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2));
  }
}

function readAll() {
  ensureDbFile();
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("Corrupt orders.json — returning empty list.", err);
    return [];
  }
}

function writeAll(orders) {
  fs.writeFileSync(DB_PATH, JSON.stringify(orders, null, 2));
}

function createOrder(order) {
  const orders = readAll();
  orders.push(order);
  writeAll(orders);
  return order;
}

function findByReference(paystackReference) {
  const orders = readAll();
  return orders.find((o) => o.paystackReference === paystackReference) || null;
}

function findById(orderId) {
  const orders = readAll();
  return orders.find((o) => o.id === orderId) || null;
}

function updateOrder(orderId, updates) {
  const orders = readAll();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return null;
  orders[idx] = { ...orders[idx], ...updates, updatedAt: new Date().toISOString() };
  writeAll(orders);
  return orders[idx];
}

module.exports = {
  readAll,
  createOrder,
  findByReference,
  findById,
  updateOrder,
};
