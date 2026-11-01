// Which market this build serves: NEXT_PUBLIC_MARKET=NA is the American demo (electronics-erp-us.ahromlabs.com); unset = IN,
// lstechnologies.in and the Indian demo, unchanged. next.config.ts always inlines it (default IN). Keep in step with
// ../utils/market.js.
// Files that branch on the market declare their own `const NA = process.env.NEXT_PUBLIC_MARKET === "NA"`: Turbopack folds a
// constant only inside its own module, so an imported NA would ship the other market's text in the bundle.
const NA = process.env.NEXT_PUBLIC_MARKET === "NA";
export const LOCALE = (): "en-US" | "en-IN" => (NA ? "en-US" : "en-IN");
export const CUR = NA ? "$" : "₹";

// MARKET=NA: the finance screens' Tally wording in plain US bookkeeping terms (tooltips, notes, titles). Identity in India.
const WORDS: [RegExp, string][] = [
  [/^Tally ledgers/, "The ledgers"], [/Tally ledger balances?/g, "ledger balance"], [/Tally ledgers?/g, "the ledgers"], [/Tally Balance/g, "Ledger Balance"], [/Tally-recorded/g, "Recorded"],
  [/Sundry Debtor balances/g, "receivable balances"], [/Sundry Debtors/g, "Customers"], [/Cash-in-Hand/g, "Cash"], [/Bank Accounts, /g, "Bank, "],
  [/\b(from|in|to) Tally\b/g, "$1 the books"], [/\bTally\b/g, "the books"],
];
export const books = (s: string): string => (NA ? WORDS.reduce((t, [a, b]) => t.replace(a, b), s) : s);
