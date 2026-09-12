/**
 * config/plans.js
 *
 * This file is the single source of truth for what you sell and how each sale
 * is actually fulfilled behind the scenes via the Gladtidings wholesale API.
 *
 * Each plan has:
 *  - id            : unique string used by the frontend/order form to reference this plan
 *  - network       : "mtn" | "glo"  (must match Gladtidings' network IDs in NETWORK_IDS below)
 *  - size          : display label, e.g. "1GB"
 *  - validity      : display label, e.g. "1 day"
 *  - sellingPrice  : what the CUSTOMER pays (Naira)
 *  - fulfillment   : an array of one or more wholesale calls to make on Gladtidings.
 *                    Most plans fire ONE call. "Combo" plans (like your 10/15/20GB
 *                    MTN plans) fire the SAME wholesale plan multiple times, or a
 *                    mix of two different wholesale plans (like the 6GB one).
 *
 * IMPORTANT: dataId values below come directly from the Gladtidings price list
 * you pulled from your gladtidingsdata.com dashboard. If Gladtidings changes
 * their price list or IDs, update this file — nothing else in the codebase
 * needs to change.
 */

const NETWORK_IDS = {
  mtn: 1,
  glo: 2,
};

const PLANS = [
  // ---------------- MTN ----------------
  {
    id: "mtn-1gb-7d",
    network: "mtn",
    size: "1GB",
    validity: "7 days",
    sellingPrice: 500,
    fulfillment: [{ dataId: 861, wholesaleCost: 380 }],
  },

  // ---------------- GLO ----------------
  {
    id: "glo-1gb-3d",
    network: "glo",
    size: "1GB",
    validity: "3 days",
    sellingPrice: 360,
    fulfillment: [{ dataId: 632, wholesaleCost: 335 }],
  },
  {
    id: "glo-1gb-7d",
    network: "glo",
    size: "1GB",
    validity: "7 days",
    sellingPrice: 380,
    fulfillment: [{ dataId: 635, wholesaleCost: 350 }],
  },
  {
    id: "glo-2.5gb-2d",
    network: "glo",
    size: "2.5GB",
    validity: "2 days",
    sellingPrice: 500,
    fulfillment: [{ dataId: 493, wholesaleCost: 478 }],
  },
  {
    id: "glo-3gb-3d",
    network: "glo",
    size: "3GB",
    validity: "3 days",
    sellingPrice: 1100,
    fulfillment: [{ dataId: 633, wholesaleCost: 1005 }],
  },
  {
    id: "glo-10gb-7d",
    network: "glo",
    size: "10GB",
    validity: "7 days",
    sellingPrice: 2000,
    fulfillment: [{ dataId: 494, wholesaleCost: 1888 }],
  },
  {
    id: "glo-45mb-1d",
    network: "glo",
    size: "45MB",
    validity: "1 day",
    sellingPrice: 50,
    fulfillment: [{ dataId: 574, wholesaleCost: 46.5 }],
  },
  // ---------------- NEW GLO PLANS ----------------
  {
    id: "glo-500mb-1d",
    network: "glo",
    size: "500MB",
    validity: "1 day",
    sellingPrice: 100,
    fulfillment: [{ dataId: 810, wholesaleCost: 96 }],
  },
  {
    id: "glo-1gb-1d",
    network: "glo",
    size: "1GB",
    validity: "1 day",
    sellingPrice: 200,
    fulfillment: [{ dataId: 811, wholesaleCost: 195 }],
  },
  {
    id: "glo-1gb-30d",
    network: "glo",
    size: "1GB",
    validity: "30 days",
    sellingPrice: 450,
    fulfillment: [{ dataId: 334, wholesaleCost: 400 }],
  },
  {
    id: "glo-1.5gb-1d",
    network: "glo",
    size: "1.5GB",
    validity: "1 day",
    sellingPrice: 300,
    fulfillment: [{ dataId: 492, wholesaleCost: 290 }],
  },
  {
    id: "glo-6gb-1d",
    network: "glo",
    size: "6GB",
    validity: "1 day",
    sellingPrice: 900,
    fulfillment: [{ dataId: 813, wholesaleCost: 873 }],
  },
  {
    id: "glo-335mb-social-7d",
    network: "glo",
    size: "335MB",
    validity: "7 days",
    sellingPrice: 100,
    fulfillment: [{ dataId: 863, wholesaleCost: 90 }],
  },
];

function getPlanById(id) {
  return PLANS.find((p) => p.id === id) || null;
}

function totalWholesaleCost(plan) {
  return plan.fulfillment.reduce((sum, f) => sum + f.wholesaleCost, 0);
}

module.exports = {
  PLANS,
  NETWORK_IDS,
  getPlanById,
  totalWholesaleCost,
};