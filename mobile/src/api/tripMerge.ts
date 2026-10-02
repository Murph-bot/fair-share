import type { Expense, Payment, Trip } from "../domain";

export type MergeResult = { trip: Trip; conflict: boolean };

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
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

// Three-way merge of a list keyed by id: an item unchanged on one side defers
// to whatever the other side did (including removing it); an item changed
// differently on both sides is a true conflict and keeps the remote value.
function mergeById<T extends { id: string }>(base: T[], local: T[], remote: T[]): { items: T[]; conflict: boolean } {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const ids = new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()]);

  const items: T[] = [];
  let conflict = false;

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
      conflict = true;
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

  return { items, conflict };
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

function withPaymentId(payment: Payment): Payment & { id: string } {
  return { ...payment, id: paymentId(payment) };
}

function stripPaymentId(payment: Payment & { id: string }): Payment {
  const { id: _id, ...rest } = payment;
  return rest;
}

// Merges a local offline edit back into the latest remote trip, using the
// trip snapshot the local edit was originally based on as the common
// ancestor. Additions made on either side are kept; an item edited
// differently on both sides is flagged as a conflict and the remote value
// wins so no edit is silently lost.
export function mergeTrips(base: Trip, local: Trip, remote: Trip): MergeResult {
  const name = mergeScalar(base.name, local.name, remote.name);
  const currency = mergeScalar(base.currency, local.currency, remote.currency);
  const archivedAt = mergeScalar(base.archivedAt, local.archivedAt, remote.archivedAt);
  const people = mergeStringSet(base.people, local.people, remote.people);
  const expenses = mergeById<Expense>(base.expenses, local.expenses, remote.expenses);
  const payments = mergeById(
    (base.completedPayments ?? []).map(withPaymentId),
    (local.completedPayments ?? []).map(withPaymentId),
    (remote.completedPayments ?? []).map(withPaymentId),
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

  const conflict = name.conflict || currency.conflict || archivedAt.conflict || expenses.conflict || payments.conflict;

  return { trip, conflict };
}
