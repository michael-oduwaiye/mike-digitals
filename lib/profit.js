/* My profit calculator */
const PAYSTACK_FEE_RATE = Number(process.env.PAYSTACK_FEE_RATE ?? 0.015);
const WALLET_FUNDING_FEE_RATE = Number(
  process.env.WALLET_FUNDING_FEE_RATE ?? 0.005
);

function calculateProfit({ sellingPrice, wholesaleCost }) {
  if (
    !Number.isFinite(sellingPrice) ||
    !Number.isFinite(wholesaleCost) ||
    sellingPrice < 0 ||
    wholesaleCost < 0
  ) {
    throw new Error("Invalid selling price or wholesale cost.");
  }

  const paystackFee = sellingPrice * PAYSTACK_FEE_RATE;
  const amountAfterPaystack = sellingPrice - paystackFee;
  const walletFundingFee =
    amountAfterPaystack * WALLET_FUNDING_FEE_RATE;

  const totalFees = paystackFee + walletFundingFee;
  const netProfit = sellingPrice - wholesaleCost - totalFees;

  return {
    paystackFee,
    amountAfterPaystack,
    walletFundingFee,
    totalFees,
    profit: netProfit,
    profitMargin:
      sellingPrice > 0 ? (netProfit / sellingPrice) * 100 : 0,
  };
}

module.exports = { calculateProfit };
