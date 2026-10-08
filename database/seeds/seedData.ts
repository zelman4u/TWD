/**
 * Tagoloan Water District Municipal Seed Data
 * Initial dataset for barangays, service zones, and sample consumers.
 */

export interface BarangaySeed {
  id: string;
  name: string;
  code: string;
  zoneOffice: string;
}

export const BARANGAYS_SEED: BarangaySeed[] = [
  { id: "bg-poblacion", name: "Poblacion", code: "POB", zoneOffice: "District Central Hall" },
  { id: "bg-baluarte", name: "Baluarte", code: "BAL", zoneOffice: "Sub-Station North" },
  { id: "bg-natumolan", name: "Natumolan", code: "NAT", zoneOffice: "Zone 2 Field Hub" },
  { id: "bg-mohon", name: "Mohon", code: "MOH", zoneOffice: "Coastal Station" },
  { id: "bg-santa-ana", name: "Santa Ana", code: "STA", zoneOffice: "East Valley Station" },
  { id: "bg-casinglot", name: "Casinglot", code: "CAS", zoneOffice: "Highland Reservoir" },
  { id: "bg-santa-cruz", name: "Santa Cruz", code: "STC", zoneOffice: "Zone 5 Field Office" },
  { id: "bg-sugbongcogon", name: "Sugbongcogon", code: "SUG", zoneOffice: "South Junction" },
  { id: "bg-gracia", name: "Gracia", code: "GRA", zoneOffice: "Zone 8 Outpost" },
  { id: "bg-rosario", name: "Rosario", code: "ROS", zoneOffice: "Industrial Zone Gate" }
];

export const TARIFF_BRACKETS_SEED = {
  residential: {
    minimumCharge: 124.50,
    minimumCuM: 10,
    brackets: [
      { from: 11, to: 20, ratePerCuM: 14.50 },
      { from: 21, to: 30, ratePerCuM: 17.00 },
      { from: 31, to: 9999, ratePerCuM: 20.25 }
    ]
  },
  commercial: {
    minimumCharge: 249.00,
    minimumCuM: 10,
    brackets: [
      { from: 11, to: 20, ratePerCuM: 29.00 },
      { from: 21, to: 30, ratePerCuM: 34.00 },
      { from: 31, to: 9999, ratePerCuM: 40.50 }
    ]
  }
};
