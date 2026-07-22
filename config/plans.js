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
    id: "mtn-1gb-1d",
    network: "mtn",
    size: "1GB",
    validity: "1 day",
    sellingPrice: 270,
    fulfillment: [{ dataId: 789, wholesaleCost: 215 }], // MTN AWOOF 1GB/Daily
  },
  {
    id: "mtn-1gb-2d",
    network: "mtn",
    size: "1GB",
    validity: "2 days",
    sellingPrice: 400,
    fulfillment: [{ dataId: 808, wholesaleCost: 370 }], // MTN AWOOF 1GB/2 days
  },
  {
    id: "mtn-1gb-7d",
    network: "mtn",
    size: "1GB",
    validity: "7 days",
    sellingPrice: 500,
    fulfillment: [{ dataId: 472, wholesaleCost: 400 }], // MTN DATA SHARE 1GB/7 days
  },
  {
    id: "mtn-5gb-14d",
    network: "mtn",
    size: "5GB",
    validity: "14 days",
    sellingPrice: 1400,
    fulfillment: [{ dataId: 217, wholesaleCost: 1050 }], // MTN GIFTING 5GB/14 days
  },
  {
    id: "mtn-6gb-7d",
    network: "mtn",
    size: "6GB",
    validity: "14d + 7d (combo)",
    sellingPrice: 2000,
    combo: true,
    comboLabel: "5GB · 14 days + 1GB · 7 days",
    comboTooltip:
      "Delivered as two bundles sent together: 5GB valid for 14 days, plus 1GB valid for 7 days.",
    fulfillment: [
      { dataId: 217, wholesaleCost: 1050 }, // 5GB / 14 days
      { dataId: 472, wholesaleCost: 400 }, // 1GB / 7 days
    ],
  },
  {
    id: "mtn-10gb-14d",
    network: "mtn",
    size: "10GB",
    validity: "14 days",
    sellingPrice: 2800,
    combo: true,
    comboLabel: "2 × 5GB · 14 days",
    comboTooltip:
      "Delivered as two 5GB bundles sent together, both valid for 14 days.",
    fulfillment: [
      { dataId: 217, wholesaleCost: 1050 },
      { dataId: 217, wholesaleCost: 1050 },
    ],
  },
  {
    id: "mtn-15gb-14d",
    network: "mtn",
    size: "15GB",
    validity: "14 days",
    sellingPrice: 3800,
    combo: true,
    comboLabel: "3 × 5GB · 14 days",
    comboTooltip:
      "Delivered as three 5GB bundles sent together, all valid for 14 days.",
    fulfillment: [
      { dataId: 217, wholesaleCost: 1050 },
      { dataId: 217, wholesaleCost: 1050 },
      { dataId: 217, wholesaleCost: 1050 },
    ],
  },
  {
    id: "mtn-20gb-14d",
    network: "mtn",
    size: "20GB",
    validity: "14 days",
    sellingPrice: 4800,
    combo: true,
    comboLabel: "4 × 5GB · 14 days",
    comboTooltip:
      "Delivered as four 5GB bundles sent together, all valid for 14 days.",
    fulfillment: [
      { dataId: 217, wholesaleCost: 1050 },
      { dataId: 217, wholesaleCost: 1050 },
      { dataId: 217, wholesaleCost: 1050 },
      { dataId: 217, wholesaleCost: 1050 },
    ],
  },

  // ---------------- GLO ----------------
  {
    id: "glo-1gb-3d",
    network: "glo",
    size: "1GB",
    validity: "3 days",
    sellingPrice: 300,
    fulfillment: [{ dataId: 632, wholesaleCost: 285 }], // GLO CORPORATE GIFTING 1GB/3 days
  },
  {
    id: "glo-1gb-7d",
    network: "glo",
    size: "1GB",
    validity: "7 days",
    sellingPrice: 330,
    fulfillment: [{ dataId: 635, wholesaleCost: 310 }], // GLO CORPORATE GIFTING 1GB/7 days
  },
  {
    id: "glo-3gb-3d",
    network: "glo",
    size: "3GB",
    validity: "3 days",
    sellingPrice: 900,
    fulfillment: [{ dataId: 633, wholesaleCost: 855 }], // GLO CORPORATE GIFTING 3GB/3 days
  },
  {
    id: "glo-5gb-3d",
    network: "glo",
    size: "5GB",
    validity: "3 days",
    sellingPrice: 1550,
    fulfillment: [{ dataId: 634, wholesaleCost: 1425 }], // GLO CORPORATE GIFTING 5GB/3 days
  },
  {  id: "glo-200mb-14d",
	    network: "glo",
	    size: "45MB",
	    validity: "1 days",
	    sellingPrice: 60,
	    fulfillment: [{ dataId: 574, wholesaleCost: 46.5 }], // GLO SME 45MB/1 day
	  },
  {
    id: "glo-10gb-7d",
    network: "glo",
    size: "10GB",
    validity: "7 days",
    sellingPrice: 2000,
    fulfillment: [{ dataId: 494, wholesaleCost: 1888 }], // GLO SME 10GB/7 days
  },
];

function getPlanById(id) {
  return PLANS.find((p) => p.id === id) || null;
}

function totalWholesaleCost(plan) {
  return plan.fulfillment.reduce((sum, f) => sum + f.wholesaleCost, 0);
}

module.exports = { PLANS, NETWORK_IDS, getPlanById, totalWholesaleCost };
