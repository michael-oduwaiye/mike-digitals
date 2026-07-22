/**
 * lib/gladtidings.js
 *
 * Wraps the Gladtidings "Buy Data" endpoint. Handles both simple plans
 * (one API call) and combo plans (multiple calls fired in sequence, e.g.
 * your 10GB plan = two 5GB calls back to back).
 *
 * IMPORTANT ON PARTIAL FAILURE:
 * If a combo plan's first call succeeds but a later one fails (e.g. wallet
 * ran out mid-order), the customer has received SOME but not all of their
 * data. This module reports that clearly back to the caller (see
 * `fulfillPlan`'s return shape) so routes/orders.js can flag the order for
 * manual follow-up rather than silently under-delivering.
 */

const axios = require("axios");
const { NETWORK_IDS } = require("../config/plans");

function client() {
  const token = process.env.GLADTIDINGS_TOKEN;
  const baseUrl = process.env.GLADTIDINGS_BASE_URL || "https://gladtidingsdata.com";
  if (!token) {
    throw new Error("GLADTIDINGS_TOKEN is not set in your .env file.");
  }
  return axios.create({
    baseURL: baseUrl,
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
    },
  });
}

/**
 * Fires a single data purchase call.
 * @param {Object} params
 * @param {number} params.networkId
 * @param {number} params.dataId - the "plan" ID from Gladtidings' price list
 * @param {string} params.mobileNumber
 * @returns {Promise<{success: boolean, raw: Object, error?: string}>}
 */
async function buySingleData({ networkId, dataId, mobileNumber }) {
  try {
    const res = await client().post("/api/data/", {
      network: networkId,
      mobile_number: mobileNumber,
      plan: dataId,
      Ported_number: true,
    });
    return { success: true, raw: res.data };
  } catch (err) {
    const raw = err.response ? err.response.data : null;
    return {
      success: false,
      raw,
      error: raw?.api_response || err.message || "Unknown Gladtidings error",
    };
  }
}

/**
 * Fulfills a full plan (single or combo) by firing one or more calls
 * IN SEQUENCE (not parallel — this matches how you'd do it manually, and
 * avoids hammering Gladtidings' API with simultaneous requests for one order).
 *
 * @param {Object} plan - a plan object from config/plans.js
 * @param {string} mobileNumber
 * @returns {Promise<{
 *   fullySuccessful: boolean,
 *   partiallyDelivered: boolean,
 *   results: Array<{dataId: number, success: boolean, raw: Object, error?: string}>
 * }>}
 */
async function fulfillPlan(plan, mobileNumber) {
  const networkId = NETWORK_IDS[plan.network];
  if (!networkId) {
    throw new Error(`Unknown network "${plan.network}" for plan ${plan.id}`);
  }

  const results = [];
  for (const step of plan.fulfillment) {
    const result = await buySingleData({
      networkId,
      dataId: step.dataId,
      mobileNumber,
    });
    results.push({ dataId: step.dataId, ...result });

    // Stop firing further calls in this combo if one fails — no point
    // trying to send the rest if something's already wrong (e.g. wallet empty).
    if (!result.success) break;
  }

  const fullySuccessful = results.length === plan.fulfillment.length && results.every((r) => r.success);
  const partiallyDelivered = results.some((r) => r.success) && !fullySuccessful;

  return { fullySuccessful, partiallyDelivered, results };
}

module.exports = { buySingleData, fulfillPlan };
