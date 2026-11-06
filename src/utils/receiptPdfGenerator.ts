/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Consumer, MeterReading } from '../types';
import {
  getReadingTotalAssessment,
  getCanonicalBillSettlement,
} from './tariffCalculator';
import { formatOdometerReading } from './odometer';

const OFFICIAL_LOGO_URL = 'https://lh3.googleusercontent.com/d/1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg';
const FALLBACK_LOGO_URL = 'https://drive.google.com/thumbnail?id=1R8aOCfamLWF4BN_r3Nk02-6juOR6Zqjg&sz=w500';

const getBase64ImageWithTimeout = async (url: string, fallbackUrl?: string, timeoutMs = 1500): Promise<string | null> => {
  const loadAttempt = async (targetUrl: string, allowFallback: boolean): Promise<string | null> => {
    try {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(targetUrl, { mode: 'cors', signal: controller.signal });
      clearTimeout(abortTimer);
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
        if (dataUrl) return dataUrl;
      }
    } catch {
      // Fallback to Image + Canvas
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 200;
          canvas.height = img.naturalHeight || 200;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
            return;
          }
        } catch {
          // Ignore
        }
        resolve(null);
      };
      img.onerror = () => {
        if (allowFallback && fallbackUrl && fallbackUrl !== targetUrl) {
          loadAttempt(fallbackUrl, false).then(resolve);
        } else {
          resolve(null);
        }
      };
      img.src = targetUrl;
    });
  };

  return loadAttempt(url, true);
};

/**
 * Downloads official Tagoloan Water District Water Billing Notice PDF.
 */
export async function downloadWaterBillingNoticePdf(params: {
  reading: MeterReading;
  consumer: Consumer;
}): Promise<{ success: boolean; fileName: string; error?: string }> {
  const { reading, consumer } = params;
  const safeAcc = (consumer.accountNumber || reading.accountNumber || 'PENDING').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safePeriod = (reading.billingPeriod || reading.readingDate || 'Notice').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `TWD_Water_Billing_Notice_${safeAcc}_${safePeriod}.pdf`;

  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = 210;
    const margin = 14;

    // Load official logo with safe timeout
    const logoData = await getBase64ImageWithTimeout(OFFICIAL_LOGO_URL, FALLBACK_LOGO_URL, 1500);
    if (logoData) {
      try {
        doc.addImage(logoData, 'PNG', margin, 10, 18, 18);
      } catch {
        // Safe skip if logo format fails
      }
    }

    // Letterhead
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('REPUBLIC OF THE PHILIPPINES', pageWidth / 2, 13, { align: 'center' });

    doc.setFontSize(13);
    doc.text('TAGOLOAN WATER DISTRICT', pageWidth / 2, 19, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(
      'Poblacion, Tagoloan, Misamis Oriental 9001 • Provincial Water Utilities Act (PD 198)',
      pageWidth / 2,
      24,
      { align: 'center' }
    );
    doc.text(
      'Commercial Operations & Billing Division • Hotline: (088) 890-4946',
      pageWidth / 2,
      28,
      { align: 'center' }
    );

    // Dividers
    doc.setDrawColor(30, 58, 138);
    doc.setLineWidth(0.6);
    doc.line(margin, 32, pageWidth - margin, 32);
    doc.setLineWidth(0.2);
    doc.line(margin, 33, pageWidth - margin, 33);

    // Document Title
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.text('OFFICIAL WATER BILLING NOTICE', pageWidth / 2, 39, { align: 'center' });

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Billing Cycle: ${reading.billingPeriod || 'Current'}  •  Invoice No: ${reading.invoiceNumber || 'INV-PENDING'}`,
      pageWidth / 2,
      44,
      { align: 'center' }
    );

    // Consumer Information Box
    const cls = consumer.consumerType || (reading.classification === 'Commercial' ? 'Commercial' : 'Residential');
    const assessment = getReadingTotalAssessment(reading, cls);
    const settlement = getCanonicalBillSettlement(reading, cls);

    const prevReading = reading.previousReading ?? 0;
    const currReading = reading.currentReading ?? reading.presentReading ?? 0;
    const consumption = reading.consumption ?? Math.max(0, currReading - prevReading);

    let cursorY = 48;
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      head: [['ACCOUNT INFORMATION', 'METER & READING TELEMETRY']],
      body: [
        [
          `Account Number: ${consumer.accountNumber || reading.accountNumber || 'N/A'}\n` +
          `Consumer Name: ${consumer.name || reading.consumerName || 'Valued Consumer'}\n` +
          `Service Address: ${consumer.address || 'Tagoloan, Misamis Oriental'}\n` +
          `Barangay: ${consumer.barangay || 'Tagoloan'}\n` +
          `Classification: ${cls.toUpperCase()}`,
          `Meter Tag Number: ${consumer.meterNumber || reading.meterNumber || 'Pending'}\n` +
          `Reading Date: ${reading.readingDate || 'N/A'}\n` +
          `Due Date: ${reading.dueDate || 'Upon Receipt'}\n` +
          `Previous Reading: ${formatOdometerReading(prevReading)} m³\n` +
          `Present Reading: ${formatOdometerReading(currReading)} m³\n` +
          `Total Consumption: ${consumption} m³`
        ]
      ],
      theme: 'grid',
      headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 8, fontStyle: 'bold' },
      styles: { fontSize: 7.5, cellPadding: 3, textColor: [15, 23, 42] },
    });

    const infoEndY = (doc as any).lastAutoTable?.finalY ?? 95;

    // Billing Breakdown Table (Preserving official layout)
    autoTable(doc, {
      startY: infoEndY + 6,
      margin: { left: margin, right: margin },
      head: [['BILLING ASSESSMENT ITEM', 'BREAKDOWN DETAILS', 'ASSESSED AMOUNT (PHP)']],
      body: [
        [
          'Basic Water Charge',
          `Volumetric consumption (${consumption} m³ @ official tariff schedule)`,
          `PHP ${assessment.basicCharge.toFixed(2)}`
        ],
        [
          'Franchise Tax (2%)',
          'Statutory 2% local franchise levy pursuant to provincial water code',
          `PHP ${assessment.franchiseTax.toFixed(2)}`
        ],
        [
          'Arrears (Past Due Balance)',
          assessment.arrears > 0
            ? 'Unpaid carried-forward balance from prior billing periods'
            : 'Account in good standing (No prior arrears)',
          `PHP ${assessment.arrears.toFixed(2)}`
        ],
        [
          {
            content: 'TOTAL AMOUNT DUE (On or Before Due Date)',
            colSpan: 2,
            styles: { fontStyle: 'bold', halign: 'right' }
          },
          {
            content: `PHP ${assessment.totalBeforeDue.toFixed(2)}`,
            styles: { fontStyle: 'bold', textColor: [30, 58, 138] }
          }
        ],
        [
          'Late Payment Surcharge (10%)',
          '10% penalty on Basic Charge applied after payment due date',
          `PHP ${assessment.penaltyAmount.toFixed(2)}`
        ],
        [
          {
            content: 'TOTAL AMOUNT DUE (After Due Date)',
            colSpan: 2,
            styles: { fontStyle: 'bold', halign: 'right' }
          },
          {
            content: `PHP ${assessment.amountAfterDueDate.toFixed(2)}`,
            styles: { fontStyle: 'bold', textColor: [185, 28, 28] }
          }
        ]
      ],
      theme: 'grid',
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 8, fontStyle: 'bold' },
      styles: { fontSize: 7.5, cellPadding: 2.5 },
    });

    const tableEndY = (doc as any).lastAutoTable?.finalY ?? 170;

    // Settlement Status Banner
    const isPaid = settlement.isCleared;
    const isPartial = settlement.isPartial;
    const statusText = isPaid
      ? 'SETTLED IN FULL (PHP 0.00 DUE)'
      : isPartial
        ? `PARTIALLY PAID: PHP ${settlement.paidAmount.toFixed(2)} CREDITED (REMAINING: PHP ${settlement.remainingBalance.toFixed(2)})`
        : `UNPAID STATEMENT: PHP ${settlement.remainingBalance.toFixed(2)} DUE`;

    doc.setFillColor(isPaid ? 236 : isPartial ? 254 : 254, isPaid ? 253 : isPartial ? 243 : 242, isPaid ? 245 : isPartial ? 199 : 242);
    doc.setDrawColor(isPaid ? 16 : isPartial ? 217 : 225, isPaid ? 185 : isPartial ? 119 : 29, isPaid ? 129 : isPartial ? 6 : 72);
    doc.rect(margin, tableEndY + 5, pageWidth - margin * 2, 10, 'FD');

    doc.setTextColor(isPaid ? 4 : isPartial ? 146 : 153, isPaid ? 120 : isPartial ? 64 : 27, isPaid ? 87 : isPartial ? 14 : 27);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(`Official Settlement Status: ${statusText}`, margin + 4, tableEndY + 11.5);

    // Official Barcode & Certification
    const sigY = Math.min(260, tableEndY + 22);
    doc.setTextColor(71, 85, 105);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(
      'Reminders: Please present this statement when paying at the Tagoloan Water District Office. Keep official receipts as proof of payment.',
      margin,
      sigY,
      { maxWidth: pageWidth - margin * 2 }
    );

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text('||||| |||| |||||| ||||| |||| ||||||', margin, sigY + 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`TWD-STMT-${reading.id || 'REF'}-${safeAcc}`, margin, sigY + 16);

    const sigColW = (pageWidth - margin * 2) / 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text('OFFICIAL ELECTRONIC SEAL', margin + sigColW, sigY + 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${new Date().toLocaleString('en-US')}`, margin + sigColW, sigY + 14);
    doc.text('Tagoloan Water District Billing Ledger', margin + sigColW, sigY + 17);

    // Output & Trigger Browser Download
    const pdfBlob = doc.output('blob');
    const blobUrl = URL.createObjectURL(pdfBlob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

    return { success: true, fileName };
  } catch (err: any) {
    return { success: false, fileName, error: err?.message || 'Failed to generate PDF' };
  }
}

/**
 * Downloads official Tagoloan Water District Official Receipt (OR) PDF.
 */
export async function downloadOfficialReceiptPdf(params: {
  orNumber: string;
  cashierName?: string;
  paymentDate?: string;
  paymentMethod?: string;
  transactionId?: string;
  accountNumber: string;
  consumerName: string;
  address?: string;
  barangay?: string;
  meterNumber?: string;
  basicCharge: number;
  franchiseTax: number;
  arrears: number;
  grossTotal: number;
  amountPaid: number;
  remainingBalance: number;
  notes?: string;
}): Promise<{ success: boolean; fileName: string; error?: string }> {
  const safeOr = (params.orNumber || 'OR').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeAcc = (params.accountNumber || 'ACC').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `TWD_Official_Receipt_${safeOr}_${safeAcc}.pdf`;

  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = 210;
    const margin = 14;

    // Official Logo
    const logoData = await getBase64ImageWithTimeout(OFFICIAL_LOGO_URL, FALLBACK_LOGO_URL, 1500);
    if (logoData) {
      try {
        doc.addImage(logoData, 'PNG', margin, 10, 18, 18);
      } catch {
        // Safe skip
      }
    }

    // Letterhead
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('REPUBLIC OF THE PHILIPPINES', pageWidth / 2, 13, { align: 'center' });

    doc.setFontSize(13);
    doc.text('TAGOLOAN WATER DISTRICT', pageWidth / 2, 19, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(
      'Poblacion, Tagoloan, Misamis Oriental 9001 • Provincial Water Utilities Act (PD 198)',
      pageWidth / 2,
      24,
      { align: 'center' }
    );
    doc.text(
      'Treasury & Cashiering Operations • Hotline: (088) 890-4946',
      pageWidth / 2,
      28,
      { align: 'center' }
    );

    // Dividers
    doc.setDrawColor(16, 185, 129);
    doc.setLineWidth(0.6);
    doc.line(margin, 32, pageWidth - margin, 32);
    doc.setLineWidth(0.2);
    doc.line(margin, 33, pageWidth - margin, 33);

    // Document Title
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('OFFICIAL RECEIPT (OR)', pageWidth / 2, 39, { align: 'center' });

    doc.setFontSize(8.5);
    doc.setTextColor(16, 185, 129);
    doc.text(`RECEIPT NUMBER: ${params.orNumber}`, pageWidth / 2, 44, { align: 'center' });

    // Receipt Meta Box
    const payDate = params.paymentDate || new Date().toLocaleDateString('en-US');
    const cashier = params.cashierName || 'Official TWD Cashier';
    const method = params.paymentMethod || 'Cash Payment';

    let cursorY = 48;
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      head: [['PAYER & ACCOUNT INFORMATION', 'TRANSACTION & CASHIER METADATA']],
      body: [
        [
          `Account Number: ${params.accountNumber}\n` +
          `Account Name: ${params.consumerName}\n` +
          `Service Address: ${params.address || params.barangay || 'Tagoloan'}\n` +
          `Barangay: ${params.barangay || 'Tagoloan'}\n` +
          `Meter Tag: ${params.meterNumber || 'Verified'}`,
          `Official Receipt: ${params.orNumber}\n` +
          `Payment Date: ${payDate}\n` +
          `Cashier Staff: ${cashier}\n` +
          `Payment Method: ${method}\n` +
          `Transaction Ref: ${params.transactionId || 'TXN-CASH'}`
        ]
      ],
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8, fontStyle: 'bold' },
      styles: { fontSize: 7.5, cellPadding: 3, textColor: [15, 23, 42] },
    });

    const metaEndY = (doc as any).lastAutoTable?.finalY ?? 95;

    // Breakdown Table
    const isFullSettlement = params.remainingBalance <= 0.01;
    autoTable(doc, {
      startY: metaEndY + 6,
      margin: { left: margin, right: margin },
      head: [['STATEMENT COMPONENT', 'CREDIT ALLOCATION DESCRIPTION', 'AMOUNT (PHP)']],
      body: [
        [
          'Basic Water Charge',
          'Credited towards basic water consumption charge',
          `PHP ${params.basicCharge.toFixed(2)}`
        ],
        [
          'Franchise Tax (2%)',
          'Statutory 2% local franchise tax contribution',
          `PHP ${params.franchiseTax.toFixed(2)}`
        ],
        [
          'Arrears Credited / Included',
          params.arrears > 0
            ? 'Applied to older carried-forward delinquent billing periods'
            : 'No prior outstanding arrears (Account current)',
          `PHP ${params.arrears.toFixed(2)}`
        ],
        [
          {
            content: 'GROSS STATEMENT CHARGES',
            colSpan: 2,
            styles: { fontStyle: 'bold', halign: 'right' }
          },
          {
            content: `PHP ${params.grossTotal.toFixed(2)}`,
            styles: { fontStyle: 'bold' }
          }
        ],
        [
          {
            content: isFullSettlement ? 'TOTAL AMOUNT PAID (FULL SETTLEMENT)' : 'AMOUNT PAID / PARTIAL CREDIT',
            colSpan: 2,
            styles: { fontStyle: 'bold', halign: 'right', textColor: [16, 185, 129] }
          },
          {
            content: `PHP ${params.amountPaid.toFixed(2)}`,
            styles: { fontStyle: 'bold', textColor: [16, 185, 129] }
          }
        ],
        [
          {
            content: 'REMAINING OUTSTANDING BALANCE DUE',
            colSpan: 2,
            styles: { fontStyle: 'bold', halign: 'right', textColor: isFullSettlement ? [16, 185, 129] : [217, 119, 6] }
          },
          {
            content: `PHP ${params.remainingBalance.toFixed(2)}`,
            styles: { fontStyle: 'bold', textColor: isFullSettlement ? [16, 185, 129] : [217, 119, 6] }
          }
        ]
      ],
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], textColor: 255, fontSize: 8, fontStyle: 'bold' },
      styles: { fontSize: 7.5, cellPadding: 2.8 },
    });

    const tableEndY = (doc as any).lastAutoTable?.finalY ?? 170;

    // Receipt Footer & Signatures
    const sigY = Math.min(255, tableEndY + 18);
    doc.setTextColor(71, 85, 105);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(
      'This official receipt serves as authentic proof of payment issued by Tagoloan Water District pursuant to Philippine Government Accounting and Auditing Rules. Keep for your records.',
      margin,
      sigY,
      { maxWidth: pageWidth - margin * 2 }
    );

    const sigColW = (pageWidth - margin * 2) / 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(cashier.toUpperCase(), margin, sigY + 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('Authorized Cashier / Collection Officer', margin, sigY + 20);
    doc.text('Tagoloan Water District', margin, sigY + 23);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text('AUTHENTICATED ELECTRONIC SEAL', margin + sigColW, sigY + 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Official OR: ${params.orNumber}`, margin + sigColW, sigY + 20);
    doc.text(`Issued: ${payDate}`, margin + sigColW, sigY + 23);

    // Browser Download Trigger
    const pdfBlob = doc.output('blob');
    const blobUrl = URL.createObjectURL(pdfBlob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

    return { success: true, fileName };
  } catch (err: any) {
    return { success: false, fileName, error: err?.message || 'Failed to generate receipt PDF' };
  }
}

/**
 * Cleanly prints a receipt or notice DOM element using an isolated hidden iframe.
 * Avoids modal overlays, scrollbar clipping, or printing surrounding page elements.
 */
export function printCleanElement(elementId: string): void {
  const targetEl = document.getElementById(elementId);
  if (!targetEl) {
    window.print();
    return;
  }

  try {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Tagoloan Water District - Print</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 12mm;
            }
            body {
              font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              color: #0f172a;
              background: #ffffff;
              margin: 0;
              padding: 0;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            * {
              box-sizing: border-box;
            }
            .no-print, button {
              display: none !important;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
          </style>
        </head>
        <body>
          ${targetEl.outerHTML}
        </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.print();
      } finally {
        setTimeout(() => {
          if (iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          }
        }, 1000);
      }
    }, 250);
  } catch {
    window.print();
  }
}
