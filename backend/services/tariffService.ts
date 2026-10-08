export interface ComputedTariff {
  cubicMetersUsed: number;
  basicCharge: number;
  franchiseTax: number;
  maintenanceFee: number;
  surcharge: number;
  totalAmount: number;
}

export function computeWaterTariff(
  previousReading: number,
  currentReading: number,
  consumerType: "Residential" | "Commercial" = "Residential",
  isPastDue = false
): ComputedTariff {
  const cubicMetersUsed = Math.max(0, currentReading - previousReading);
  const maintenanceFee = 10.00;
  let basicCharge = 0;

  if (consumerType === "Residential") {
    // ₱124.50 minimum for first 10 cu.m
    const baseMin = 124.50;
    if (cubicMetersUsed <= 10) {
      basicCharge = baseMin;
    } else {
      let remaining = cubicMetersUsed - 10;
      let tierCost = baseMin;
      // 11 - 20 cu.m @ ₱14.50
      const tier1 = Math.min(remaining, 10);
      tierCost += tier1 * 14.50;
      remaining -= tier1;
      // 21 - 30 cu.m @ ₱17.00
      if (remaining > 0) {
        const tier2 = Math.min(remaining, 10);
        tierCost += tier2 * 17.00;
        remaining -= tier2;
      }
      // 31+ cu.m @ ₱20.25
      if (remaining > 0) {
        tierCost += remaining * 20.25;
      }
      basicCharge = tierCost;
    }
  } else {
    // Commercial bracket
    const baseMin = 249.00;
    if (cubicMetersUsed <= 10) {
      basicCharge = baseMin;
    } else {
      let remaining = cubicMetersUsed - 10;
      let tierCost = baseMin;
      const tier1 = Math.min(remaining, 10);
      tierCost += tier1 * 29.00;
      remaining -= tier1;
      if (remaining > 0) {
        const tier2 = Math.min(remaining, 10);
        tierCost += tier2 * 34.00;
        remaining -= tier2;
      }
      if (remaining > 0) {
        tierCost += remaining * 40.50;
      }
      basicCharge = tierCost;
    }
  }

  const franchiseTax = parseFloat((basicCharge * 0.02).toFixed(2));
  let subtotal = basicCharge + franchiseTax + maintenanceFee;
  const surcharge = isPastDue ? parseFloat((subtotal * 0.10).toFixed(2)) : 0;
  const totalAmount = parseFloat((subtotal + surcharge).toFixed(2));

  return {
    cubicMetersUsed,
    basicCharge: parseFloat(basicCharge.toFixed(2)),
    franchiseTax,
    maintenanceFee,
    surcharge,
    totalAmount
  };
}
