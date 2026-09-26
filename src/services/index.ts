/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tagoloan Water District - Central Services Barrel Export
 * 
 * Provides unified entry points for all backend client integrations, 
 * realtime WebSocket communication, Firestore synchronization, and
 * background grace-period automated scanners.
 */

export * from './apiClient';
export * from './firebaseDb';
export * from './gracePeriodScannerService';
export * from './realtimeSocket';
