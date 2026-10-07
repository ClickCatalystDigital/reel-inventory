// Mirrors utils/visibility.js's ITEM_CATEGORIES (the server validates against its own copy).
export const ITEM_CATEGORIES = [
  "Diode", "Electrolytic Capacitor", "FILM CAP", "IC", "MLCC", "MOV", "PCBA",
  "Printed Circuit Board", "RESISTOR", "SLCC", "SMD Tan Cap", "Transistor",
];

export interface Company {
  id: number;
  name: string;
}

// The API sends company links as a comma-separated string (SQL group_concat) or null.
export const parseIds = (s: string | null | undefined) => (s ? s.split(",").map(Number) : []);
