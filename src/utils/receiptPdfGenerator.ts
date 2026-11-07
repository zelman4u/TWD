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
 * Clones parent document stylesheets and injects robust print CSS to ensure consistent,
 * pixel-perfect text alignment, grid structures, tabular figures, and borders.
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
    iframe.style.visibility = 'hidden';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    // Collect parent stylesheets and link tags to preserve custom fonts and core styles
    const styleTags = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map(node => node.outerHTML)
      .join('\n');

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Tagoloan Water District - Official Document</title>
          ${styleTags}
          <style>
            @page {
              size: A4 portrait;
              margin: 10mm 12mm;
            }
            *, *::before, *::after {
              box-sizing: border-box !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            html, body {
              background: #ffffff !important;
              color: #0f172a !important;
              margin: 0 !important;
              padding: 0 !important;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
              font-size: 11px !important;
              line-height: 1.4 !important;
            }
            .no-print, button, .print\\:hidden, input, select {
              display: none !important;
            }
            
            /* Root print notice card styling */
            #official-billing-notice-print-area,
            #consumer-receipt-slip-area,
            #admin-official-receipt-card {
              background: #ffffff !important;
              color: #0f172a !important;
              border: 1.5px solid #0f172a !important;
              border-radius: 6px !important;
              box-shadow: none !important;
              max-width: 100% !important;
              width: 100% !important;
              margin: 0 auto !important;
              padding: 18px !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }

            /* Flexbox utilities */
            .flex {
              display: flex !important;
            }
            .inline-flex {
              display: inline-flex !important;
            }
            .flex-col {
              flex-direction: column !important;
            }
            .flex-row {
              flex-direction: row !important;
            }
            .justify-between {
              justify-content: space-between !important;
            }
            .justify-center {
              justify-content: center !important;
            }
            .justify-start {
              justify-content: flex-start !important;
            }
            .justify-end {
              justify-content: flex-end !important;
            }
            .items-center {
              align-items: center !important;
            }
            .items-baseline {
              align-items: baseline !important;
            }
            .items-start {
              align-items: flex-start !important;
            }
            .shrink-0 {
              flex-shrink: 0 !important;
            }

            /* Grid utilities for 2-column key-value alignment */
            .grid {
              display: grid !important;
            }
            .grid-cols-1 {
              grid-template-columns: repeat(1, minmax(0, 1fr)) !important;
            }
            .grid-cols-2, .sm\\:grid-cols-2, .md\\:grid-cols-2, .print\\:grid-cols-2 {
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            }
            .col-span-1 {
              grid-column: span 1 / span 1 !important;
            }
            .col-span-2, .sm\\:col-span-2, .md\\:col-span-2 {
              grid-column: span 2 / span 2 !important;
            }
            .gap-x-6 {
              column-gap: 1.5rem !important;
            }
            .gap-x-8 {
              column-gap: 2rem !important;
            }
            .gap-y-1 {
              row-gap: 0.25rem !important;
            }
            .gap-y-1\\.5 {
              row-gap: 0.375rem !important;
            }
            .gap-y-2 {
              row-gap: 0.5rem !important;
            }
            .gap-y-2\\.5 {
              row-gap: 0.625rem !important;
            }
            .gap-2 {
              gap: 0.5rem !important;
            }
            .gap-3 {
              gap: 0.75rem !important;
            }

            /* Text alignment & numbers */
            .text-left {
              text-align: left !important;
            }
            .text-center {
              text-align: center !important;
            }
            .text-right {
              text-align: right !important;
            }
            .font-mono {
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
            }
            .tabular-nums {
              font-variant-numeric: tabular-nums !important;
            }
            .font-bold {
              font-weight: 700 !important;
            }
            .font-black {
              font-weight: 900 !important;
            }
            .font-semibold {
              font-weight: 600 !important;
            }
            .font-medium {
              font-weight: 500 !important;
            }
            .uppercase {
              text-transform: uppercase !important;
            }
            .truncate {
              overflow: hidden !important;
              text-overflow: ellipsis !important;
              white-space: nowrap !important;
            }

            /* Widths */
            .w-full {
              width: 100% !important;
            }
            .w-1\\/4 {
              width: 25% !important;
            }
            .w-1\\/2 {
              width: 50% !important;
            }
            .w-28 {
              width: 7rem !important;
              min-width: 7rem !important;
            }

            /* Tables */
            table {
              width: 100% !important;
              border-collapse: collapse !important;
              table-layout: fixed !important;
              margin: 4px 0 !important;
            }
            th {
              font-weight: 700 !important;
              color: #475569 !important;
              border-bottom: 2px solid #0f172a !important;
              padding: 6px 4px !important;
              font-size: 10px !important;
              text-transform: uppercase !important;
              letter-spacing: 0.025em !important;
            }
            td {
              padding: 6px 4px !important;
              border-bottom: 1px solid #e2e8f0 !important;
              color: #0f172a !important;
              vertical-align: middle !important;
            }
            th.text-left, td.text-left {
              text-align: left !important;
            }
            th.text-center, td.text-center {
              text-align: center !important;
            }
            th.text-right, td.text-right {
              text-align: right !important;
            }

            /* High contrast color overrides for crisp printing */
            .text-white, .text-slate-100, .text-slate-200 {
              color: #0f172a !important;
            }
            .text-slate-300, .text-slate-400 {
              color: #334155 !important;
            }
            .text-slate-500, .text-slate-600 {
              color: #475569 !important;
            }
            .text-sky-400, .text-blue-600, .text-blue-700, .text-blue-800 {
              color: #1d4ed8 !important;
            }
            .text-emerald-400, .text-emerald-500, .text-emerald-700, .text-emerald-800 {
              color: #047857 !important;
            }
            .text-rose-400, .text-rose-500, .text-rose-700 {
              color: #b91c1c !important;
            }
            .text-amber-300, .text-amber-400, .text-amber-700, .text-amber-800 {
              color: #b45309 !important;
            }

            /* Neutralize dark box backgrounds and convert to print borders */
            .bg-slate-950, .bg-slate-900, .bg-slate-900\\/80, .bg-slate-900\\/60, .bg-slate-950\\/60, .bg-slate-950\\/70 {
              background-color: #f8fafc !important;
              border-color: #cbd5e1 !important;
              color: #0f172a !important;
            }
            .bg-emerald-950\\/60, .bg-emerald-950 {
              background-color: #ecfdf5 !important;
              border-color: #a7f3d0 !important;
              color: #065f46 !important;
            }
            .bg-amber-950\\/60, .bg-amber-950 {
              background-color: #fffbeb !important;
              border-color: #fde68a !important;
              color: #92400e !important;
            }
            .bg-blue-600, .bg-blue-700 {
              background-color: #1e40af !important;
              color: #ffffff !important;
            }

            /* Dividers and borders */
            .border-slate-800, .border-slate-700, .border-slate-900 {
              border-color: #cbd5e1 !important;
            }
            .border-dashed {
              border-style: dashed !important;
            }
            .border-b {
              border-bottom-width: 1px !important;
            }
            .border-b-2 {
              border-bottom-width: 2px !important;
            }
          </style>
        </head>
        <body>
          <div style="padding: 10px; max-width: 100%;">
            ${targetEl.outerHTML}
          </div>
        </body>
      </html>
    `);
    doc.close();

    // Give the iframe time to load all cloned stylesheets and fonts before printing
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
        }, 1500);
      }
    }, 350);
  } catch {
    window.print();
  }
}
