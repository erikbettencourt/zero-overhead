/**
 * Suggest the merchant, or the first words of the bank's description, as the text to match.
 * A bank transfer (ACH) reads "COMPANY DES:note ID:… INDN:… CO ID:…": only the company stays the
 * same from one payment to the next, so that's the suggestion.
 */
export function suggestMatch(t: { name: string; merchantName?: string | null }) {
  if (t.merchantName) return t.merchantName;
  const ach = /^(.+?)\s+DES:/i.exec(t.name);
  if (ach) return ach[1].trim();
  return t.name
    .replace(/[#*].*$/, "")
    .replace(/\b\d{3,}\b.*$/, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
}
