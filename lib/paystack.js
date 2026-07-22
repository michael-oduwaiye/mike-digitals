/**
 * lib/paystack.js
 *
 * Thin wrapper around the two Paystack calls this project needs:
 *  1. initializeTransaction — starts a payment, returns a checkout URL
 *  2. verifyTransaction     — confirms whether a payment actually succeeded
 *
 * Paystack amounts are always in KOBO (1 Naira = 100 Kobo) — helper handles
 * that conversion so the rest of the app can just think in Naira.
 */

const axios = require("axios");

const PAYSTACK_BASE_URL = "https://api.paystack.co";

function client() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("PAYSTACK_SECRET_KEY is not set in your .env file.");
  }
  return axios.create({
    baseURL: PAYSTACK_BASE_URL,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
  });
}

/**
 * Starts a Paystack transaction.
 * @param {Object} params
 * @param {string} params.email - customer's email (Paystack requires one; use a placeholder if you don't collect it)
 * @param {number} params.amountNaira - amount in Naira (converted to Kobo internally)
 * @param {string} params.reference - your own unique order reference
 * @param {string} params.callbackUrl - where Paystack redirects the customer after payment
 * @returns {Promise<{authorizationUrl: string, accessCode: string, reference: string}>}
 */
async function initializeTransaction({ email, amountNaira, reference, callbackUrl }) {
  const res = await client().post("/transaction/initialize", {
    email,
    amount: Math.round(amountNaira * 100), // Naira -> Kobo
    reference,
    callback_url: callbackUrl,
  });

  const { authorization_url, access_code, reference: ref } = res.data.data;
  return { authorizationUrl: authorization_url, accessCode: access_code, reference: ref };
}

/**
 * Verifies a Paystack transaction by reference.
 * @param {string} reference
 * @returns {Promise<{status: string, amountNaira: number, raw: Object}>}
 */
async function verifyTransaction(reference) {
  const res = await client().get(`/transaction/verify/${encodeURIComponent(reference)}`);
  const data = res.data.data;
  return {
    status: data.status, // "success" | "failed" | "abandoned" etc.
    amountNaira: data.amount / 100,
    raw: data,
  };
}

module.exports = { initializeTransaction, verifyTransaction };
