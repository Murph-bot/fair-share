import type { Expense, Payment, Trip } from "../domain";

export type TripConflict = { type: "expense" | "payment" | "field"; id?: string; description: string };

export type MergeResult = { trip: Trip; conflicts: TripConflict[] };

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  // Union (not count) the keys: parseTrip() round-trips optional fields as an
  // explicit `undefined` (e.g. `completedAt: undefined`), while a value
  // built directly by domain helpers may simply omit the key. Both must
  // compare equal, since the wire format (and every other consumer) treats
  // an absent key the same as one set to undefined.
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(aRecord), ...Object.keys(bRecord)]);
  for (const key of keys) {
    if (!deepEqual(aRecord[key], bRecord[key])) {
      return false;
    }
  }
  return true;
}

type ItemConflict<T> = { id: string; local?: T; remote?: T };

// Three-way merge of a list keyed by id: an item unchanged on one side defers
// to whatever the other side did (including removing it); an item changed
// differently on both sides is a true conflict and keeps the remote value,
// reporting what the local side wanted so the caller can tell the user.
function mergeById<T extends { id: string }>(
  base: T[],
  local: T[],
  remote: T[],
): { items: T[]; conflicts: ItemConflict<T>[] } {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const ids = new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()]);

  const items: T[] = [];
  const conflicts: ItemConflict<T>[] = [];

  for (const id of ids) {
    const baseItem = baseById.get(id);
    const localItem = localById.get(id);
    const remoteItem = remoteById.get(id);
    const localChanged = !deepEqual(localItem, baseItem);
    const remoteChanged = !deepEqual(remoteItem, baseItem);

    if (!localChanged) {
      if (remoteItem) items.push(remoteItem);
    } else if (!remoteChanged) {
      if (localItem) items.push(localItem);
    } else if (deepEqual(localItem, remoteItem)) {
      if (localItem) items.push(localItem);
    } else {
      conflicts.push({ id, local: localItem, remote: remoteItem });
      if (remoteItem) items.push(remoteItem);
    }
  }

  const order = remote.map((item) => item.id);
  items.sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return { items, conflicts };
}

function mergeStringSet(base: string[], local: string[], remote: string[]): string[] {
  const localAdded = local.filter((name) => !base.includes(name));
  const localRemoved = base.filter((name) => !local.includes(name));
  const merged = remote.filter((name) => !localRemoved.includes(name));
  for (const name of localAdded) {
    if (!merged.includes(name)) {
      merged.push(name);
    }
  }
  return merged;
}

function mergeScalar<T>(base: T, local: T, remote: T): { value: T; conflict: boolean } {
  const localChanged = !deepEqual(local, base);
  const remoteChanged = !deepEqual(remote, base);
  if (!localChanged) return { value: remote, conflict: false };
  if (!remoteChanged) return { value: local, conflict: false };
  if (deepEqual(local, remote)) return { value: local, conflict: false };
  return { value: remote, conflict: true };
}

function paymentId(payment: Payment): string {
  return `${payment.frm}>${payment.to}:${payment.amount_cents}`;
}

// Multiple completed payments can share the same frm/to/amount; disambiguate
// by occurrence so a merge doesn't collapse distinct duplicates into one.
function withPaymentIds(payments: Payment[]): Array<Payment & { id: string }> {
  const seen = new Map<string, number>();
  return payments.map((payment) => {
    const key = paymentId(payment);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return { ...payment, id: `${key}#${occurrence}` };
  });
}

function stripPaymentId(payment: Payment & { id: string }): Payment {
  const { id: _id, ...rest } = payment;
  return rest;
}

// Merges a local offline edit back into the latest remote trip, using the
// trip snapshot the local edit was originally based on as the common
// ancestor. Additions made on either side are kept; an item edited
// differently on both sides is a true conflict: the remote value wins and
// the discarded local edit is reported so the caller can tell the user.
export function mergeTrips(base: Trip, local: Trip, remote: Trip): MergeResult {
  const name = mergeScalar(base.name, local.name, remote.name);
  const currency = mergeScalar(base.currency, local.currency, remote.currency);
  const archivedAt = mergeScalar(base.archivedAt, local.archivedAt, remote.archivedAt);
  const people = mergeStringSet(base.people, local.people, remote.people);
  const expenses = mergeById<Expense>(base.expenses, local.expenses, remote.expenses);
  const payments = mergeById(
    withPaymentIds(base.completedPayments ?? []),
    withPaymentIds(local.completedPayments ?? []),
    withPaymentIds(remote.completedPayments ?? []),
  );

  const trip: Trip = {
    schema_version: remote.schema_version,
    name: name.value,
    people,
    expenses: expenses.items,
    completedPayments: payments.items.map(stripPaymentId),
    archivedAt: archivedAt.value,
    currency: currency.value,
  };

  const conflicts: TripConflict[] = [];
  if (name.conflict) conflicts.push({ type: "field", description: "Trip name" });
  if (currency.conflict) conflicts.push({ type: "field", description: "Currency" });
  if (archivedAt.conflict) conflicts.push({ type: "field", description: "Archived status" });
  for (const c of expenses.conflicts) {
    const edit = c.local ?? c.remote;
    conflicts.push({ type: "expense", id: c.id, description: edit?.description ?? c.id });
  }
  for (const c of payments.conflicts) {
    const edit = c.local ?? c.remote;
    conflicts.push({ type: "payment", id: c.id, description: edit ? `${edit.frm} → ${edit.to}` : c.id });
  }

  return { trip, conflicts };
}
