export interface DisconnectionNoticePayload {
  accountNumber: string;
  consumerName: string;
  totalOverdue: number;
  unpaidCycles: number;
  finalCutoffDate: string;
}

export function generateDisconnectionNotice(payload: DisconnectionNoticePayload) {
  return {
    title: "FINAL NOTICE OF DISCONNECTION - TAGOLOAN WATER DISTRICT",
    referenceNo: `NOD-${payload.accountNumber}-${Date.now().toString().slice(-4)}`,
    accountNumber: payload.accountNumber,
    consumerName: payload.consumerName,
    body: `Your water service account has accumulated ${payload.unpaidCycles} unpaid billing cycles amounting to ₱${payload.totalOverdue.toLocaleString("en-PH", { minimumFractionDigits: 2 })}. Please settle at least 50% of the balance at the TWD Office before ${payload.finalCutoffDate} to prevent disconnection.`,
    issuedAt: new Date().toISOString()
  };
}
