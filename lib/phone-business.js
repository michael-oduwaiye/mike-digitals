const mongoose = require("mongoose");

const inventoryItemSchema = new mongoose.Schema(
  {
    itemName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },

    category: {
      type: String,
      required: true,
      enum: ["accessory", "spare-part", "tool", "other"],
    },

    variant: {
      type: String,
      trim: true,
      default: "",
      maxlength: 150,
    },

    quantity: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Quantity must be a whole number.",
      },
    },

    costPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    sellingPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    lowStockThreshold: {
      type: Number,
      required: true,
      default: 5,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Low-stock threshold must be a whole number.",
      },
    },
  },
  {
    timestamps: true,
  }
);

inventoryItemSchema.index({
  itemName: 1,
  category: 1,
});

const stockMovementSchema = new mongoose.Schema(
  {
    inventoryItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InventoryItem",
      required: true,
      index: true,
    },

    itemNameSnapshot: {
      type: String,
      required: true,
    },

    movementType: {
      type: String,
      required: true,
      enum: [
        "opening-stock",
        "purchase",
        "sale",
        "repair-usage",
        "return",
        "adjustment",
      ],
    },

    quantityChange: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: "Stock movement must be a whole number.",
      },
    },

    unitCostPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    unitSellingPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    referenceType: {
      type: String,
      enum: ["sale", "repair", "purchase", "manual", null],
      default: null,
    },

    referenceId: {
      type: String,
      default: null,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

stockMovementSchema.index({
  createdAt: -1,
});

const InventoryItem = mongoose.model(
  "InventoryItem",
  inventoryItemSchema
);

const StockMovement = mongoose.model(
  "StockMovement",
  stockMovementSchema
);


const repairJobSchema = new mongoose.Schema(
  {
    jobNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 50,
    },

    customerName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },

    customerPhone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },

    deviceBrand: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    deviceModel: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },

    deviceModelNumber: {
    type: String,
    trim: true,
    default: "",
    maxlength: 150,
    },

    reportedFault: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },

    diagnosis: {
      type: String,
      trim: true,
      default: "",
      maxlength: 3000,
    },

    repairNotes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 3000,
    },

    status: {
      type: String,
      enum: [
        "received",
        "diagnosing",
        "awaiting-parts",
        "in-progress",
        "repaired",
        "collected",
        "unrepairable",
        "cancelled",
      ],
      default: "received",
      required: true,
    },

    estimatedCost: {
      type: Number,
      min: 0,
      default: 0,
    },

    repairCost: {
      type: Number,
      min: 0,
      default: 0,
    },

    // Amount already received before payment-history tracking.
    // Null distinguishes older records from newly created records.
    openingAmountPaid: {
      type: Number,
      min: 0,
      default: null,
    },

    // Individual payments received for this repair job.
    payments: [
      {
        amount: {
          type: Number,
          required: true,
          min: 0.01,
          max: 100000000,
        },

        paymentMethod: {
          type: String,
          enum: ["cash", "transfer", "pos", "other"],
          required: true,
        },

        paidAt: {
          type: Date,
          required: true,
          default: Date.now,
        },

        reference: {
          type: String,
          trim: true,
          maxlength: 100,
          default: "",
        },

        notes: {
          type: String,
          trim: true,
          maxlength: 500,
          default: "",
        },
      },
    ],

    // Cached total of openingAmountPaid plus recorded payments.
    amountPaid: {
      type: Number,
      min: 0,
      default: 0,
    },

    balance: {
      type: Number,
      min: 0,
      default: 0,
    },

    warrantyDays: {
      type: Number,
      min: 0,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: "Warranty days must be a whole number.",
      },
    },

    warrantyExpiresAt: {
      type: Date,
      default: null,
    },

    partsUsed: [
      {
        inventoryItemId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "InventoryItem",
          required: true,
        },

        itemNameSnapshot: {
          type: String,
          required: true,
        },

        // Preserves the inventory category at the time of sale.
        // Historical sales were accessory-only under the previous sale route.
        categorySnapshot: {
          type: String,
          enum: ["accessory", "spare-part", "tool", "other"],
          default: "accessory",
        },

        quantity: {
          type: Number,
          required: true,
          min: 1,
          validate: {
            validator: Number.isInteger,
            message: "Parts quantity must be a whole number.",
          },
        },

        unitCostPrice: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],

    customerComplaint: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000,
    },

    internalNotes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 3000,
    },

    receivedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    collectedAt: {
      type: Date,
      default: null,
    },

  // Cancellation tracking
    cancelledAt: {
      type: Date,
      default: null,
    },

    cancellationReason: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000,
    },

    // Archive tracking
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },

    archivedAt: {
      type: Date,
      default: null,
    },

  },
  {
    timestamps: true,
  }
);

repairJobSchema.index({ createdAt: -1 });
repairJobSchema.index({ customerPhone: 1, createdAt: -1 });


const saleSchema = new mongoose.Schema(
  {
    saleNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 50,
    },

    customerName: {
      type: String,
      trim: true,
      default: "",
      maxlength: 150,
    },

    customerPhone: {
      type: String,
      trim: true,
      default: "",
      maxlength: 20,
    },

    items: [
      {
        inventoryItemId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "InventoryItem",
          required: true,
        },

        itemNameSnapshot: {
          type: String,
          required: true,
        },

        quantity: {
          type: Number,
          required: true,
          min: 1,
          validate: {
            validator: Number.isInteger,
            message: "Sale quantity must be a whole number.",
          },
        },

        unitSellingPrice: {
          type: Number,
          required: true,
          min: 0,
        },

        unitCostPrice: {
          type: Number,
          required: true,
          min: 0,
        },

        lineTotal: {
          type: Number,
          required: true,
          min: 0,
        },

                // Warranty assigned by the owner at the point of sale.
        warrantyDays: {
          type: Number,
          min: 0,
          max: 3650,
          default: 0,
          validate: {
            validator: Number.isInteger,
            message: "Warranty days must be a whole number.",
          },
        },

        warrantyExpiresAt: {
          type: Date,
          default: null,
        },

      },
    ],

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    discount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Preserves payments received before payment-history tracking.
    // Null distinguishes older sales from newly recorded sales.
    openingAmountPaid: {
      type: Number,
      min: 0,
      default: null,
    },

    // Individual payments received for this sale.
    payments: [
      {
        amount: {
          type: Number,
          required: true,
          min: 0.01,
          max: 100000000,
        },

        paymentMethod: {
          type: String,
          enum: ["cash", "transfer", "pos", "other"],
          required: true,
        },

        paidAt: {
          type: Date,
          required: true,
          default: Date.now,
        },

        reference: {
          type: String,
          trim: true,
          maxlength: 100,
          default: "",
        },

        notes: {
          type: String,
          trim: true,
          maxlength: 500,
          default: "",
        },
      },
    ],

    // Cached total of openingAmountPaid plus recorded payments.
    amountPaid: {
      type: Number,
      required: true,
      min: 0,
    },

    balance: {
      type: Number,
      required: true,
      min: 0,
    },

    paymentMethod: {
      type: String,
      enum: ["cash", "transfer", "pos", "other"],
      default: "cash",
      required: true,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000,
    },

    soldAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

saleSchema.index({ soldAt: -1 });
saleSchema.index({ customerPhone: 1, soldAt: -1 });


const businessExpenseSchema = new mongoose.Schema(
  {
    expenseNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 50,
    },

    category: {
      type: String,
      required: true,
      enum: [
        "rent",
        "electricity",
        "internet",
        "transport",
        "maintenance",
        "staff",
        "marketing",
        "bank-charges",
        "other",
      ],
    },

    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },

    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },

    paymentMethod: {
      type: String,
      enum: ["cash", "transfer", "pos", "other"],
      default: "cash",
      required: true,
    },

    incurredAt: {
      type: Date,
      default: Date.now,
      required: true,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000,
    },
  },
  {
    timestamps: true,
  }
);

businessExpenseSchema.index({ incurredAt: -1 });
businessExpenseSchema.index({ category: 1, incurredAt: -1 });


const Sale = mongoose.model("Sale", saleSchema);

// Persistent counters for generating unique business references.
const sequenceCounterSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },

    sequence: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  {
    versionKey: false,
  }
);

const SequenceCounter = mongoose.model(
  "SequenceCounter",
  sequenceCounterSchema
);

const BusinessExpense = mongoose.model(
  "BusinessExpense",
  businessExpenseSchema
);


const RepairJob = mongoose.model("RepairJob", repairJobSchema);

module.exports = {
  InventoryItem,
  StockMovement,
  RepairJob,
  Sale,
  BusinessExpense,
  SequenceCounter,
};
