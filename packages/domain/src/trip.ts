import { ExpenseNotFoundError, UnknownPersonError, ValidationError } from "./errors";
import type { Payment } from "./settlement";

export const SCHEMA_VERSION = 1;
export const TRIP_ID_RE = /^[a-f0-9]{32}$/;

export const DEFAULT_CURRENCY = "EUR";

export type Expense = {
  id: string;
  description: string;
  payer: string;
  amount_cents: number;
  participants: string[];
  weights?: number[];
  date?: string;
  category?: string;
  note?: string;
  currency?: string;
  exchange_rate?: string;
  tax_cents?: number;
  tip_cents?: number;
};

export type Trip = {
  schema_version: number;
  name: string;
  people: string[];
  expenses: Expense[];
  completedPayments?: Payment[];
  archivedAt?: string;
  currency?: string;
};

export function newTripId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function findCanonical(people: string[], name: string): string | undefined {
  const lower = name.trim().toLowerCase();
  return people.find((p) => p.toLowerCase() === lower);
}

function normalizePersonName(raw: string): string {
  const name = raw.trim();
  if (!name) {
    throw new ValidationError("Person name cannot be empty");
  }
  if (name.includes(",")) {
    throw new ValidationError("Person names cannot contain commas");
  }
  return name;
}

export function validateExpense(expense: Expense, people: string[]): void {
  if (!expense.id || typeof expense.id !== "string") {
    throw new ValidationError("Expense id is required");
  }
  const description = expense.description.trim();
  if (!description) {
    throw new ValidationError("Expense description cannot be empty");
  }
  if (!Number.isInteger(expense.amount_cents) || expense.amount_cents <= 0) {
    throw new ValidationError(`amount_cents must be positive, got ${expense.amount_cents}`);
  }
  if (!Array.isArray(expense.participants) || expense.participants.length === 0) {
    throw new ValidationError("Select at least one person to split with");
  }
  if (new Set(expense.participants).size !== expense.participants.length) {
    throw new ValidationError("The same person cannot appear twice in a split");
  }

  const payer = findCanonical(people, expense.payer);
  if (payer === undefined) {
    throw new UnknownPersonError(`Payer '${expense.payer}' is not on this trip`);
  }

  for (const name of expense.participants) {
    if (findCanonical(people, name) === undefined) {
      throw new UnknownPersonError(`Participant '${name}' is not on this trip`);
    }
  }

  if (expense.weights !== undefined) {
    if (expense.weights.length !== expense.participants.length) {
      throw new ValidationError(
        `weights length (${expense.weights.length}) must match participants (${expense.participants.length})`,
      );
    }
    if (expense.weights.some((w) => !Number.isInteger(w) || w <= 0)) {
      throw new ValidationError(`All weights must be positive, got ${expense.weights}`);
    }
  }

  if (expense.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(expense.date)) {
    throw new ValidationError(`Invalid date format, expected YYYY-MM-DD: ${expense.date}`);
  }

  if (expense.category !== undefined && expense.category.includes(",")) {
    throw new ValidationError("Category cannot contain commas");
  }

  if (expense.currency !== undefined && !/^[A-Z]{3}$/.test(expense.currency)) {
    throw new ValidationError(`Invalid currency code, expected 3 uppercase letters: ${expense.currency}`);
  }

  if (expense.exchange_rate !== undefined) {
    const rate = Number(expense.exchange_rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new ValidationError(`Exchange rate must be a positive number, got ${expense.exchange_rate}`);
    }
  }

  for (const [field, value] of [
    ["tax_cents", expense.tax_cents],
    ["tip_cents", expense.tip_cents],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new ValidationError(`${field} must be a non-negative integer, got ${value}`);
    }
  }
}

/**
 * Total expense value expressed in the trip's currency (cents).
 * Tax and tip are added to the amount, then the exchange rate converts
 * the expense currency into the trip currency.
 */
export function effectiveAmountCents(expense: Expense): number {
  const total = expense.amount_cents + (expense.tax_cents ?? 0) + (expense.tip_cents ?? 0);
  if (expense.exchange_rate === undefined) {
    return total;
  }
  return Math.round(total * Number(expense.exchange_rate));
}

export function createTrip(name: string, currency: string = DEFAULT_CURRENCY): Trip {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new ValidationError("Trip name cannot be empty");
  }
  const normalizedCurrency = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    throw new ValidationError(`Invalid currency code: ${currency}`);
  }
  return {
    schema_version: SCHEMA_VERSION,
    name: trimmed,
    people: [],
    expenses: [],
    completedPayments: [],
    currency: normalizedCurrency,
  };
}

export function addPerson(trip: Trip, rawName: string): Trip {
  const name = normalizePersonName(rawName);
  if (findCanonical(trip.people, name) !== undefined) {
    return trip;
  }
  return { ...trip, people: [...trip.people, name] };
}

export function renamePerson(trip: Trip, rawOldName: string, rawNewName: string): Trip {
  const oldName = findCanonical(trip.people, rawOldName);
  if (!oldName) {
    throw new UnknownPersonError(`Person '${rawOldName}' is not on this trip`);
  }
  const newName = normalizePersonName(rawNewName);
  if (newName === oldName) {
    return trip;
  }
  if (findCanonical(trip.people, newName) !== undefined) {
    throw new ValidationError(`A person named '${newName}' is already on this trip`);
  }

  const people = trip.people.map((person) => (person === oldName ? newName : person));
  const expenses = trip.expenses.map((expense) => ({
    ...expense,
    payer: expense.payer === oldName ? newName : expense.payer,
    participants: expense.participants.map((participant) =>
      participant === oldName ? newName : participant,
    ),
  }));

  return { ...trip, people, expenses };
}

export function movePerson(trip: Trip, rawName: string, direction: "up" | "down"): Trip {
  const name = findCanonical(trip.people, rawName);
  if (!name) {
    throw new UnknownPersonError(`Person '${rawName}' is not on this trip`);
  }
  const index = trip.people.indexOf(name);
  if (index === -1) {
    return trip;
  }
  const newIndex = direction === "up" ? index - 1 : index + 1;
  if (newIndex < 0 || newIndex >= trip.people.length) {
    return trip;
  }
  const people = [...trip.people];
  [people[index], people[newIndex]] = [people[newIndex], people[index]];
  return { ...trip, people };
}

export type NewExpenseInput = {
  description: string;
  payer: string;
  amount_cents: number;
  participants: string[];
  weights?: number[];
  date?: string;
  category?: string;
  note?: string;
  currency?: string;
  exchange_rate?: string;
  tax_cents?: number;
  tip_cents?: number;
};

function buildExpense(trip: Trip, input: NewExpenseInput, id: string): Expense {
  const payer = findCanonical(trip.people, input.payer);
  if (payer === undefined) {
    throw new UnknownPersonError(`Payer '${input.payer}' is not on this trip`);
  }

  const participants = input.participants.map((name) => {
    const canonical = findCanonical(trip.people, name);
    if (canonical === undefined) {
      throw new UnknownPersonError(`Participant '${name}' is not on this trip`);
    }
    return canonical;
  });

  const expense: Expense = {
    id,
    description: input.description.trim(),
    payer,
    amount_cents: input.amount_cents,
    participants,
    weights: input.weights,
    date: input.date,
    category: input.category,
    note: input.note,
    currency: input.currency,
    exchange_rate: input.exchange_rate,
    tax_cents: input.tax_cents,
    tip_cents: input.tip_cents,
  };
  validateExpense(expense, trip.people);
  return expense;
}

function findExpense(trip: Trip, expenseId: string): Expense {
  const id = expenseId.trim();
  if (!id) {
    throw new ValidationError("Expense ID cannot be empty");
  }

  const exact = trip.expenses.find((e) => e.id === id);
  if (exact) {
    return exact;
  }

  const matches = trip.expenses.filter((e) => e.id.startsWith(id));
  if (matches.length === 0) {
    throw new ExpenseNotFoundError(`No expense with id '${id}' found.`);
  }
  if (matches.length > 1) {
    throw new ValidationError(
      `Ambiguous expense id prefix ${JSON.stringify(id)}. Matches: ${matches.map((e) => e.id).join(", ")}`,
    );
  }
  return matches[0];
}

export function addExpense(trip: Trip, input: NewExpenseInput, id: string): Trip {
  const expense = buildExpense(trip, input, id);
  return { ...trip, expenses: [...trip.expenses, expense] };
}

export function updateExpense(trip: Trip, expenseId: string, input: NewExpenseInput): Trip {
  const target = findExpense(trip, expenseId);
  const expense = buildExpense(trip, input, target.id);
  return {
    ...trip,
    expenses: trip.expenses.map((item) => (item.id === target.id ? expense : item)),
  };
}

export function removeExpense(trip: Trip, expenseId: string): Trip {
  const target = findExpense(trip, expenseId);
  return { ...trip, expenses: trip.expenses.filter((e) => e.id !== target.id) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTrip(data: unknown): Trip {
  if (!isRecord(data)) {
    throw new ValidationError("Trip must be an object");
  }
  if (data.schema_version !== SCHEMA_VERSION) {
    throw new ValidationError(
      `Unsupported schema version ${String(data.schema_version)}. Expected ${SCHEMA_VERSION}.`,
    );
  }
  if (typeof data.name !== "string" || !data.name.trim()) {
    throw new ValidationError("Trip name cannot be empty");
  }
  if (!Array.isArray(data.people) || data.people.some((p) => typeof p !== "string")) {
    throw new ValidationError("people must be a list of names");
  }

  const people: string[] = [];
  for (const raw of data.people) {
    const name = normalizePersonName(raw);
    if (findCanonical(people, name) === undefined) {
      people.push(name);
    }
  }

  if (!Array.isArray(data.expenses)) {
    throw new ValidationError("expenses must be a list");
  }

  const expenses: Expense[] = [];
  const ids = new Set<string>();
  for (const item of data.expenses) {
    if (!isRecord(item)) {
      throw new ValidationError("Each expense must be an object");
    }
    const weightsRaw = item.weights;
    const weights =
      weightsRaw === undefined
        ? undefined
        : Array.isArray(weightsRaw)
          ? weightsRaw.map((w) => Number(w))
          : (() => {
              throw new ValidationError("weights must be a list of integers");
            })();

    if (typeof item.id !== "string" || typeof item.description !== "string" || typeof item.payer !== "string") {
      throw new ValidationError("Expense is missing required fields");
    }
    if (!Array.isArray(item.participants) || item.participants.some((p) => typeof p !== "string")) {
      throw new ValidationError("participants must be a list of names");
    }

    const dateRaw = item.date;
    const date = dateRaw === undefined || dateRaw === null ? undefined : String(dateRaw);
    const categoryRaw = item.category;
    const category = categoryRaw === undefined || categoryRaw === null ? undefined : String(categoryRaw);
    const noteRaw = item.note;
    const note = noteRaw === undefined || noteRaw === null ? undefined : String(noteRaw);
    const currencyRaw = item.currency;
    const currency =
      currencyRaw === undefined || currencyRaw === null ? undefined : String(currencyRaw).toUpperCase();
    const exchangeRateRaw = item.exchange_rate;
    const exchangeRate =
      exchangeRateRaw === undefined || exchangeRateRaw === null ? undefined : String(exchangeRateRaw);
    const taxCentsRaw = item.tax_cents;
    const taxCents = taxCentsRaw === undefined || taxCentsRaw === null ? undefined : Number(taxCentsRaw);
    const tipCentsRaw = item.tip_cents;
    const tipCents = tipCentsRaw === undefined || tipCentsRaw === null ? undefined : Number(tipCentsRaw);

    const expense: Expense = {
      id: item.id,
      description: item.description,
      payer: item.payer,
      amount_cents: Number(item.amount_cents),
      participants: item.participants,
      weights,
      date,
      category,
      note,
      currency,
      exchange_rate: exchangeRate,
      tax_cents: taxCents,
      tip_cents: tipCents,
    };
    if (ids.has(expense.id)) {
      throw new ValidationError(`Duplicate expense id ${expense.id}`);
    }
    ids.add(expense.id);
    validateExpense(expense, people);
    expenses.push({
      ...expense,
      payer: findCanonical(people, expense.payer) ?? expense.payer,
      participants: expense.participants.map((p) => findCanonical(people, p) ?? p),
      description: expense.description.trim(),
      date,
      category: category ? category.trim() : undefined,
      note: note ? note.trim() : undefined,
    });
  }

  const completedPayments = Array.isArray(data.completedPayments)
    ? data.completedPayments
        .filter(
          (item): item is Record<string, unknown> & { frm: string; to: string; amount_cents: number } =>
            isRecord(item) &&
            typeof item.frm === "string" &&
            typeof item.to === "string" &&
            typeof item.amount_cents === "number",
        )
        .map((item) => ({
          frm: item.frm,
          to: item.to,
          amount_cents: item.amount_cents,
          ...(typeof item.paid_cents === "number" ? { paid_cents: item.paid_cents } : {}),
          completedAt: typeof item.completedAt === "string" ? item.completedAt : undefined,
        }))
    : undefined;

  const archivedAt =
    data.archivedAt === undefined || data.archivedAt === null ? undefined : String(data.archivedAt);

  const currencyRaw = data.currency;
  const currency =
    currencyRaw === undefined || currencyRaw === null
      ? DEFAULT_CURRENCY
      : String(currencyRaw).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError(`Invalid currency code: ${currency}`);
  }

  return {
    schema_version: SCHEMA_VERSION,
    name: data.name.trim(),
    people,
    expenses,
    completedPayments,
    archivedAt,
    currency,
  };
}

function paymentKey(payment: Payment): string {
  return `${payment.frm}:${payment.to}`;
}

function paidForPair(trip: Trip, payment: Payment): number {
  const existing = trip.completedPayments ?? [];
  return existing
    .filter((p) => paymentKey(p) === paymentKey(payment))
    .reduce((sum, p) => sum + (p.paid_cents ?? p.amount_cents), 0);
}

/**
 * Record a payment (full or partial) from one person to another.
 * Multiple records for the same pair accumulate towards the suggested amount.
 */
export function recordPayment(trip: Trip, payment: Payment, paidCents?: number): Trip {
  const existing = trip.completedPayments ?? [];
  const paid = paidCents === undefined ? payment.amount_cents : paidCents;
  if (paid <= 0) {
    throw new ValidationError("Paid amount must be positive");
  }
  const completed: Payment = {
    frm: payment.frm,
    to: payment.to,
    amount_cents: payment.amount_cents,
    ...(paid === payment.amount_cents ? {} : { paid_cents: paid }),
    completedAt: new Date().toISOString(),
  };
  return { ...trip, completedPayments: [...existing, completed] };
}

export function unrecordPayment(trip: Trip, payment: Payment): Trip {
  const existing = trip.completedPayments ?? [];
  const key = paymentKey(payment);
  const next = existing.filter((p) => paymentKey(p) !== key);
  if (next.length === existing.length) {
    return trip;
  }
  return { ...trip, completedPayments: next };
}

export function isPaymentCompleted(trip: Trip, payment: Payment): boolean {
  return paidForPair(trip, payment) >= payment.amount_cents;
}

export type PaymentStatus = {
  paidCents: number;
  remainingCents: number;
  completed: boolean;
};

export function paymentStatus(trip: Trip, payment: Payment): PaymentStatus {
  const paid = paidForPair(trip, payment);
  const remaining = Math.max(0, payment.amount_cents - paid);
  return {
    paidCents: Math.min(paid, payment.amount_cents),
    remainingCents: remaining,
    completed: remaining === 0 && paid > 0,
  };
}

export function archiveTrip(trip: Trip): Trip {
  if (trip.archivedAt) {
    return trip;
  }
  return { ...trip, archivedAt: new Date().toISOString() };
}

export function unarchiveTrip(trip: Trip): Trip {
  const { archivedAt: _, ...rest } = trip;
  return rest;
}

export function createExampleTrip(name: string): Trip {
  let trip = createTrip(name);
  trip = addPerson(trip, "Alice");
  trip = addPerson(trip, "Bob");
  trip = addPerson(trip, "Charlie");
  trip = addExpense(
    trip,
    {
      description: "Dinner",
      payer: "Alice",
      amount_cents: 9000,
      participants: ["Alice", "Bob", "Charlie"],
    },
    `expense-${newTripId()}`,
  );
  trip = addExpense(
    trip,
    {
      description: "Taxi",
      payer: "Bob",
      amount_cents: 3000,
      participants: ["Alice", "Bob", "Charlie"],
    },
    `expense-${newTripId()}`,
  );
  trip = addExpense(
    trip,
    {
      description: "Hotel",
      payer: "Charlie",
      amount_cents: 24000,
      participants: ["Alice", "Bob", "Charlie"],
    },
    `expense-${newTripId()}`,
  );
  return trip;
}

export type TripTemplate = {
  id: string;
  name: string;
  people: string[];
};

export const TRIP_TEMPLATES: TripTemplate[] = [
  { id: "weekend", name: "Weekend trip", people: ["Alex", "Maria", "Nikos"] },
  { id: "dinner", name: "Dinner", people: ["Alex", "Maria"] },
  { id: "roadtrip", name: "Road trip", people: ["Alex", "Maria", "Nikos", "Elena"] },
  { id: "holiday", name: "Holiday", people: ["Alex", "Maria", "Nikos", "Elena", "Dimitris"] },
];

export function findTripTemplate(id: string): TripTemplate | undefined {
  return TRIP_TEMPLATES.find((template) => template.id === id);
}

export function createTripFromTemplate(templateId: string, name?: string): Trip {
  const template = findTripTemplate(templateId);
  if (!template) {
    throw new ValidationError(`Unknown trip template: ${templateId}`);
  }
  let trip = createTrip(name?.trim() || template.name);
  for (const person of template.people) {
    trip = addPerson(trip, person);
  }
  return trip;
}

export type BackupFile = {
  app: "fair-share";
  version: 1;
  exportedAt: string;
  trips: Trip[];
};

export function backupJson(trips: Trip[]): string {
  const backup: BackupFile = {
    app: "fair-share",
    version: 1,
    exportedAt: new Date().toISOString(),
    trips,
  };
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function parseBackup(data: unknown): Trip[] {
  if (!isRecord(data)) {
    throw new ValidationError("Backup must be an object");
  }
  if (data.app !== "fair-share" || data.version !== 1) {
    throw new ValidationError("Unsupported backup file");
  }
  if (!Array.isArray(data.trips)) {
    throw new ValidationError("Backup is missing the trips list");
  }
  return data.trips.map(parseTrip);
}

export function tripFileJson(trip: Trip): string {
  const payload: Trip = {
    schema_version: trip.schema_version,
    name: trip.name,
    people: trip.people,
    expenses: trip.expenses,
    completedPayments: trip.completedPayments,
    archivedAt: trip.archivedAt,
    currency: trip.currency,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
