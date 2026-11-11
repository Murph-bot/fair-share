import { escapeHtml } from "./escape";

export type DiagramPerson = { name: string; initials: string; fruit: string };
export type DiagramPayment = { frm: string; to: string; amount_cents: number };

const W = 320;
const H = 200;
const R = 22;

/** Arrows between friends' initials for the payments still open. Empty string when there are none. */
export function settleDiagramSvg(
  people: DiagramPerson[],
  payments: DiagramPayment[],
  money: (cents: number) => string,
  label: string,
): string {
  const names = [...new Set(payments.flatMap((p) => [p.frm, p.to]))];
  const byName = new Map(people.map((p) => [p.name, p]));
  const involved = names.map((n) => byName.get(n)).filter((p): p is DiagramPerson => p !== undefined);
  if (payments.length === 0 || involved.length < 2) return "";
  const pos = new Map(
    involved.map((p, i) => {
      const a = Math.PI + (2 * Math.PI * i) / involved.length;
      return [p.name, { x: W / 2 + 118 * Math.cos(a), y: H / 2 + 62 * Math.sin(a) }];
    }),
  );
  const arrows = payments
    .map((p) => {
      const a = pos.get(p.frm);
      const b = pos.get(p.to);
      if (!a || !b) return "";
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;
      const s = { x: a.x + ux * (R + 4), y: a.y + uy * (R + 4) };
      const e = { x: b.x - ux * (R + 8), y: b.y - uy * (R + 8) };
      const c = { x: (s.x + e.x) / 2 - uy * d * 0.22, y: (s.y + e.y) / 2 + ux * d * 0.22 };
      // Label sits outside the curve's bulge so it never covers its own arrow.
      const mid = { x: 0.25 * s.x + 0.5 * c.x + 0.25 * e.x - uy * 16, y: 0.25 * s.y + 0.5 * c.y + 0.25 * e.y + ux * 16 };
      const f = (n: number) => n.toFixed(1);
      return (
        `<path class="flow" d="M${f(s.x)} ${f(s.y)} Q${f(c.x)} ${f(c.y)} ${f(e.x)} ${f(e.y)}" marker-end="url(#fs-arrow)"/>` +
        `<text class="flow-amt" x="${f(mid.x)}" y="${f(mid.y + 4)}" text-anchor="middle">${escapeHtml(money(p.amount_cents))}</text>`
      );
    })
    .join("");
  const nodes = involved
    .map((p) => {
      const { x, y } = pos.get(p.name)!;
      return `<g class="node"><circle class="fruit-${escapeHtml(p.fruit)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${R}"/><text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle">${escapeHtml(p.initials)}</text></g>`;
    })
    .join("");
  return `<svg class="settle-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(label)}"><defs><marker id="fs-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>${arrows}${nodes}</svg>`;
}
