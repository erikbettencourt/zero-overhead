import { describe, expect, it } from "vitest";
import { suggestMatch } from "./rules";

describe("suggestMatch", () => {
  it("uses the merchant when the bank names one", () => {
    expect(suggestMatch({ name: "SQ *BLUE BOTTLE 0412", merchantName: "Blue Bottle" })).toBe("Blue Bottle");
  });

  it("keeps only the company from a bank transfer, so a changed note still matches", () => {
    const july = "Acme Co DES:Bill 1123 ID:Jane Doe INDN:Jane Doe CO ID:XXXXX12345 CCD";
    const march = "Acme Co DES:Jane Doe ID:Jane Doe INDN:Jane Doe CO ID:XXXXX12345 CCD";
    expect(suggestMatch({ name: july })).toBe("Acme Co");
    expect(suggestMatch({ name: march })).toBe("Acme Co");
  });

  it("takes the first words of anything else, dropping numbers and references", () => {
    expect(suggestMatch({ name: "FIGMA MONTHLY 4417 SAN FRANCISCO" })).toBe("FIGMA MONTHLY");
    expect(suggestMatch({ name: "AMZN Mktp US*2K4 Amzn.com/bill" })).toBe("AMZN Mktp US");
  });
});
