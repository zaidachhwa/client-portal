// Indian states and union territories with their GST state codes (first two digits of a GSTIN).
// One list for every state field, so seller and buyer states compare exactly when splitting GST.
export const STATES: [code: string, name: string][] = [
  ["35", "Andaman and Nicobar Islands"], ["37", "Andhra Pradesh"], ["12", "Arunachal Pradesh"], ["18", "Assam"], ["10", "Bihar"],
  ["04", "Chandigarh"], ["22", "Chhattisgarh"], ["26", "Dadra and Nagar Haveli and Daman and Diu"], ["07", "Delhi"], ["30", "Goa"],
  ["24", "Gujarat"], ["06", "Haryana"], ["02", "Himachal Pradesh"], ["01", "Jammu and Kashmir"], ["20", "Jharkhand"],
  ["29", "Karnataka"], ["32", "Kerala"], ["38", "Ladakh"], ["31", "Lakshadweep"], ["23", "Madhya Pradesh"],
  ["27", "Maharashtra"], ["14", "Manipur"], ["17", "Meghalaya"], ["15", "Mizoram"], ["13", "Nagaland"],
  ["21", "Odisha"], ["34", "Puducherry"], ["03", "Punjab"], ["08", "Rajasthan"], ["11", "Sikkim"],
  ["33", "Tamil Nadu"], ["36", "Telangana"], ["16", "Tripura"], ["09", "Uttar Pradesh"], ["05", "Uttarakhand"], ["19", "West Bengal"],
];

export const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
export const CIN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

export const isState = (name: string) => STATES.some(([, n]) => n === name);

// A GSTIN is issued per state: its first two digits must match the state it's registered in.
export const gstinMatchesState = (gstin: string, state: string) => STATES.find(([, n]) => n === state)?.[0] === gstin.slice(0, 2);
