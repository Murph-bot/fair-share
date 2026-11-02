// Pure presentation model for the Fruit Bowl result card.
// Reuses the domain split/settle maths unchanged; only formats and lays out.
import {
  computeBalances,
  computeStats,
  effectiveAmountCents,
  equalSplit,
  settle,
  weightedSplit,
  type Payment,
  type Trip,
} from "@fairshare/domain";

export type Lang = "en" | "el";

export const FRUITS = ["mango", "lagoon", "watermelon", "grape", "kiwi", "cobalt", "peach"] as const;
export type Fruit = (typeof FRUITS)[number];

export function localeFor(lang: Lang): string {
  return lang === "el" ? "el-GR" : "en-IE";
}

/** Locale-aware money via Intl ("12,40 €" in EL, "€12.40" in EN). Sign optional. */
export function formatMoney(cents: number, currency: string, lang: Lang, opts: { signed?: boolean } = {}): string {
  const abs = Math.abs(cents);
  let body: string;
  try {
    body = new Intl.NumberFormat(localeFor(lang), {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(abs / 100);
  } catch {
    body = `${(abs / 100).toFixed(2)} ${currency}`;
  }
  body = body.replace(/\u00a0/g, "\u00a0");
  if (!opts.signed || cents === 0) {
    return cents < 0 ? `\u2212${body}` : body;
  }
  return `${cents > 0 ? "+" : "\u2212"}${body}`;
}

export function initials(name: string): string {
  const parts = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().split(/[\s.\-_]+/u).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
  return (Array.from(parts[0])[0] + Array.from(parts[parts.length - 1])[0]).toUpperCase();
}

export function fruitFor(index: number): Fruit {
  return FRUITS[((index % FRUITS.length) + FRUITS.length) % FRUITS.length];
}

export type NetStatus = "owes" | "square" | "gets";

export function netStatus(cents: number): NetStatus {
  if (cents > 0) return "gets";
  if (cents < 0) return "owes";
  return "square";
}

export type PersonResult = {
  name: string;
  initials: string;
  fruit: Fruit;
  shape: number;
  paidCents: number;
  shareCents: number;
  netCents: number;
  status: NetStatus;
};

export type Segment = { name: string; initials: string; fruit: Fruit; weight: number; percent: number };

/** Even Bar segments: each person's share of the costs drives the width; percents sum to 100. */
export function evenBarSegments(people: PersonResult[]): Segment[] {
  const total = people.reduce((s, p) => s + Math.max(0, p.shareCents), 0);
  const active = people.filter((p) => p.shareCents > 0);
  if (total === 0 || active.length === 0) {
    const n = people.length || 1;
    return people.map((p) => ({ name: p.name, initials: p.initials, fruit: p.fruit, weight: 1, percent: 100 / n }));
  }
  return active.map((p) => ({
    name: p.name,
    initials: p.initials,
    fruit: p.fruit,
    weight: p.shareCents,
    percent: (p.shareCents / total) * 100,
  }));
}

export type ReceiptLine = { kind: "expense" | "share" | "rule" | "total" | "transfer"; left: string; right: string };

export type TripResult = {
  totalCents: number;
  currency: string;
  people: PersonResult[];
  segments: Segment[];
  transfers: Payment[];
  receipt: ReceiptLine[];
};

export function buildResult(trip: Trip, lang: Lang, labels: { total: string; perPerson: string } = { total: "TOTAL", perPerson: "SHARES" }): TripResult {
  const currency = trip.currency ?? "EUR";
  const balances = computeBalances(trip);
  const stats = computeStats(trip);
  const people: PersonResult[] = trip.people.map((name, i) => {
    const paid = stats.paidBy[name] ?? 0;
    const net = balances[name] ?? 0;
    return {
      name,
      initials: initials(name),
      fruit: fruitFor(i),
      shape: i % 4,
      paidCents: paid,
      shareCents: paid - net,
      netCents: net,
      status: netStatus(net),
    };
  });
  const transfers = settle(balances);
  const money = (c: number) => formatMoney(c, currency, lang);
  const receipt: ReceiptLine[] = [];
  for (const e of trip.expenses) {
    const total = effectiveAmountCents(e);
    receipt.push({ kind: "expense", left: `${e.description} · ${e.payer}`, right: money(total) });
    const shares = e.weights !== undefined ? weightedSplit(total, e.weights) : equalSplit(total, e.participants.length);
    e.participants.forEach((p, i) => {
      const w = e.weights !== undefined ? ` ×${e.weights[i]}` : "";
      receipt.push({ kind: "share", left: `  ${p}${w}`, right: money(shares[i]) });
    });
  }
  receipt.push({ kind: "rule", left: "", right: "" });
  receipt.push({ kind: "total", left: labels.total, right: money(stats.totalCents) });
  for (const p of people) {
    receipt.push({ kind: "share", left: `  ${labels.perPerson} ${p.name}`, right: money(p.shareCents) });
  }
  if (transfers.length > 0) receipt.push({ kind: "rule", left: "", right: "" });
  for (const tr of transfers) {
    receipt.push({ kind: "transfer", left: `${tr.frm} → ${tr.to}`, right: money(tr.amount_cents) });
  }
  return { totalCents: stats.totalCents, currency, people, segments: evenBarSegments(people), transfers, receipt };
}

const GREEK = /[\u0370-\u03ff\u1f00-\u1fff]/u;

function greekGender(name: string): "f" | "m" | "n" {
  const last = name.trim().split(/\s+/)[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/ς$/.test(last)) return "m";
  if (/[αηω]$/.test(last) || /ου$/.test(last)) return "f";
  return "n";
}

/** Masculine Greek first names drop the final ς in the accusative (Νίκος → Νίκο). */
function greekAccusative(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const acc = first.endsWith("ς") ? first.slice(0, -1) : first;
  return [acc, ...rest].join(" ");
}

/** Settle sentence. EN: "Maria pays Nikos €12.40". EL: "Η Μαρία δίνει στον Νίκο 12,40 €". */
export function settleSentence(from: string, to: string, cents: number, currency: string, lang: Lang): string {
  const amount = formatMoney(cents, currency, lang);
  if (lang !== "el") return `${from} pays ${to} ${amount}`;
  let subject = from;
  if (GREEK.test(from)) {
    const g = greekGender(from);
    subject = g === "f" ? `Η ${from}` : g === "m" ? `Ο ${from}` : from;
  }
  let object = `σε ${to}`;
  if (GREEK.test(to)) {
    const g = greekGender(to);
    object = g === "f" ? `στην ${to}` : g === "m" ? `στον ${greekAccusative(to)}` : `σε ${to}`;
  }
  return `${subject} δίνει ${object} ${amount}`;
}
