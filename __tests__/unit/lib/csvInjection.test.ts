import { csvCell, neutralizeCsvInjection, toCsv } from "@/lib/csv";

/**
 * Creator names, campaign titles and payout notes are user text and land in a
 * spreadsheet. Excel runs any cell starting with = + - @ tab or CR, so an
 * export was a way to execute a formula in a finance lead's machine. The OWASP
 * mitigation is a leading single quote.
 */
describe("neutralizeCsvInjection", () => {
  it.each(["=1+1", "+1", "@SUM(A1)", "\tcmd", "\rcmd"])(
    "prefixes a cell starting with %j",
    (value) => {
      expect(neutralizeCsvInjection(value)).toBe(`'${value}`);
    }
  );

  it("neutralises the classic command payload", () => {
    expect(neutralizeCsvInjection(`=cmd|'/c calc'!A0`)).toBe(`'=cmd|'/c calc'!A0`);
  });

  it("leaves ordinary text alone", () => {
    expect(neutralizeCsvInjection("Awx Yken")).toBe("Awx Yken");
    expect(neutralizeCsvInjection("Leak It - Remix")).toBe("Leak It - Remix");
  });

  it("does not turn a negative number into text", () => {
    expect(neutralizeCsvInjection(-100)).toBe("-100");
    expect(neutralizeCsvInjection("-100")).toBe("-100");
    expect(neutralizeCsvInjection("-1.5")).toBe("-1.5");
  });

  it("still prefixes something that only looks numeric", () => {
    expect(neutralizeCsvInjection("-1+cmd")).toBe("'-1+cmd");
  });

  it("renders null and undefined as an empty cell", () => {
    expect(neutralizeCsvInjection(null)).toBe("");
    expect(neutralizeCsvInjection(undefined)).toBe("");
  });
});

describe("csvCell", () => {
  it("quotes only when the value needs it", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("has,comma")).toBe('"has,comma"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("neutralises before quoting", () => {
    expect(csvCell('=HYPERLINK("http://evil","claim")')).toBe(
      `"'=HYPERLINK(""http://evil"",""claim"")"`
    );
  });
});

describe("toCsv", () => {
  it("neutralises every cell it writes", () => {
    expect(toCsv([["Creator", "Amount"], ["=1+1", 500]])).toBe(
      '"Creator","Amount"\n"\'=1+1","500"'
    );
  });
});
