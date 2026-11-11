import { describe, expect, it } from "vitest";
import { settleDiagramSvg } from "../src/settle-diagram";

const people = [
  { name: "Maria K", initials: "MK", fruit: "mango" },
  { name: "Sotiris", initials: "SO", fruit: "lagoon" },
  { name: "Eleni", initials: "EL", fruit: "kiwi" },
];
const money = (c: number) => `€${c / 100}`;

describe("settleDiagramSvg", () => {
  it("draws one arrow and amount per open payment, and only the people involved", () => {
    const svg = settleDiagramSvg(people, [{ frm: "Maria K", to: "Sotiris", amount_cents: 4200 }], money, "Who pays whom");
    expect(svg.match(/class="flow"/g)).toHaveLength(1);
    expect(svg).toContain(">€42<");
    expect(svg).toContain(">MK<");
    expect(svg).toContain(">SO<");
    expect(svg).not.toContain(">EL<");
    expect(svg).toContain('aria-label="Who pays whom"');
  });

  it("is empty when nothing is left to pay", () => {
    expect(settleDiagramSvg(people, [], money, "x")).toBe("");
  });

  it("escapes names and labels", () => {
    const svg = settleDiagramSvg(
      [
        { name: "<b>", initials: "<B", fruit: "mango" },
        { name: "Bo", initials: "BO", fruit: "kiwi" },
      ],
      [{ frm: "<b>", to: "Bo", amount_cents: 100 }],
      money,
      'say "hi"',
    );
    expect(svg).not.toContain("<B<");
    expect(svg).toContain("&lt;B");
    expect(svg).toContain("&quot;hi&quot;");
  });
});
