import { fetchTrip, saveTrip, type PublicTrip } from "../api";
import {
  addExpense,
  addPerson,
  centsToEuro,
  computeBalances,
  parseAmount,
  removeExpense,
  settle,
  tripFileJson,
  updateExpense,
  type Expense,
  type Trip,
} from "@fairshare/domain";
import { announce } from "../announce";
import { escapeHtml } from "../escape";
import { loadPhotoPin } from "../photo-session";
import { rememberRecent } from "../recents";
import { bindMoments, momentsSection } from "./moments";

let saveLock = false;

function setBanner(el: HTMLElement, message: string | null): void {
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function setBusy(root: HTMLElement, busy: boolean): void {
  root.querySelectorAll("button").forEach((button) => {
    button.disabled = busy;
  });
}

async function persist(id: string, trip: PublicTrip, banner: HTMLElement): Promise<PublicTrip> {
  if (saveLock) {
    throw new Error("Still saving the last change");
  }
  saveLock = true;
  try {
    const saved = await saveTrip(id, trip);
    rememberRecent(id, saved.name);
    setBanner(banner, null);
    return saved;
  } finally {
    saveLock = false;
  }
}

function peopleList(trip: Trip): string {
  if (trip.people.length === 0) {
    return `<p class="muted">Add the people who are sharing expenses.</p>`;
  }
  return `<ul class="people">${trip.people.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`;
}

function expenseCards(trip: Trip): string {
  if (trip.expenses.length === 0) {
    return `<p class="muted">No expenses yet. Add one above.</p>`;
  }
  return `<ul class="expenses">${trip.expenses
    .map((e) => {
      const weights =
        e.weights !== undefined
          ? ` · weights ${escapeHtml(e.weights.join(":"))}`
          : "";
          return `<li>
        <div>
          <strong>${escapeHtml(e.description)}</strong>
          <span class="meta">${escapeHtml(e.payer)} paid ${centsToEuro(e.amount_cents)} · ${escapeHtml(e.participants.join(", "))}${weights}</span>
        </div>
        <div class="expense-actions">
          <button type="button" class="text-btn" data-edit="${escapeHtml(e.id)}" aria-label="Edit ${escapeHtml(e.description)}">Edit</button>
          <button type="button" class="text-btn" data-remove="${escapeHtml(e.id)}" aria-label="Remove ${escapeHtml(e.description)}">Remove</button>
        </div>
      </li>`;
    })
    .join("")}</ul>`;
}

function balancesBlock(trip: Trip): string {
  if (trip.expenses.length === 0) {
    return `<p class="muted">No expenses recorded. Add expenses to see who owes what.</p>`;
  }
  const balances = computeBalances(trip);
  const rows = Object.keys(balances)
    .sort((a, b) => a.localeCompare(b))
    .map((person) => {
      const amount = balances[person];
      const sign = amount > 0 ? "+" : "";
      return `<li><span>${escapeHtml(person)}</span><span class="${amount < 0 ? "neg" : "pos"}">${sign}${centsToEuro(amount)}</span></li>`;
    })
    .join("");
  return `<p class="muted explainer">Positive = owed to this person. Negative = this person owes money.</p><ul class="ledger">${rows}</ul>`;
}

function settleBlock(trip: Trip): string {
  if (trip.expenses.length === 0) {
    return `<p class="muted">Add expenses to see who pays whom.</p>`;
  }
  const payments = settle(computeBalances(trip));
  if (payments.length === 0) {
    return `<p class="muted">All settled — no payments needed.</p>`;
  }
  return `<ul class="payments">${payments
    .map(
      (p) =>
        `<li>${escapeHtml(p.frm)} → ${escapeHtml(p.to)} <strong>${centsToEuro(p.amount_cents)}</strong></li>`,
    )
    .join("")}</ul>`;
}

function centsToFormAmount(cents: number): string {
  const abs = Math.abs(cents);
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function expenseForm(trip: Trip, editing: Expense | null): string {
  if (trip.people.length === 0) {
    return "";
  }
  const options = trip.people
    .map((p) => {
      const selected = editing !== null && p === editing.payer ? " selected" : "";
      return `<option value="${escapeHtml(p)}"${selected}>${escapeHtml(p)}</option>`;
    })
    .join("");
  const participantSet = new Set(editing?.participants ?? trip.people);
  const checks = trip.people
    .map((p) => {
      const checked = participantSet.has(p) ? " checked" : "";
      const weightIndex = editing?.participants.indexOf(p) ?? -1;
      const weight =
        editing?.weights !== undefined && weightIndex >= 0
          ? String(editing.weights[weightIndex])
          : "1";
      return `<label class="check">
        <input type="checkbox" name="participant" value="${escapeHtml(p)}"${checked}>
        <span>${escapeHtml(p)}</span>
        <input type="number" name="weight-${escapeHtml(p)}" min="1" step="1" value="${escapeHtml(weight)}" class="weight" inputmode="numeric">
      </label>`;
    })
    .join("");
  const desc = editing ? escapeHtml(editing.description) : "";
  const amount = editing ? escapeHtml(centsToFormAmount(editing.amount_cents)) : "";
  const unequal = editing?.weights !== undefined ? " checked" : "";
  const submitLabel = editing ? "Save expense" : "Add expense";
  const editingAttr = editing ? ` data-editing="${escapeHtml(editing.id)}"` : "";
  const cancel = editing
    ? `<button type="button" class="text-btn" id="cancel-edit">Cancel</button>`
    : "";
  return `
    <form id="expense-form" class="stack"${editingAttr}>
      <label for="exp-desc">Description</label>
      <input id="exp-desc" name="description" type="text" required maxlength="120" autocomplete="off" value="${desc}">
      <label for="exp-amount">Amount (€)</label>
      <input id="exp-amount" name="amount" type="text" inputmode="decimal" required placeholder="60 or 60.50" value="${amount}">
      <label for="exp-payer">Who paid</label>
      <select id="exp-payer" name="payer" required>${options}</select>
      <fieldset>
        <legend>Split between</legend>
        ${checks}
      </fieldset>
      <label class="check">
        <input type="checkbox" id="unequal" name="unequal"${unequal}>
        <span>Unequal shares (integer weights)</span>
      </label>
      <p id="expense-error" class="err" role="alert" aria-live="assertive" hidden></p>
      <button type="submit">${submitLabel}</button>
      ${cancel}
    </form>
  `;
}

function paint(root: HTMLElement, id: string, trip: PublicTrip, editingId: string | null = null): void {
  const hasPin = Boolean(loadPhotoPin(id));
  const editing = editingId ? trip.expenses.find((e) => e.id === editingId) ?? null : null;
  root.innerHTML = `
    <header class="topbar">
      <div>
        <p class="kicker"><a href="/">Fair share</a></p>
        <h1>${escapeHtml(trip.name)}</h1>
      </div>
      <div class="topbar-actions">
        <button type="button" id="copy-pin" ${hasPin ? "" : "hidden"}>Copy PIN</button>
        <button type="button" id="copy-link">Copy link</button>
        <button type="button" id="download-json">Download JSON</button>
      </div>
    </header>
    <p id="banner" class="err" role="alert" aria-live="assertive" hidden></p>
    <main class="page trip">
      <section class="block">
        <h2>People</h2>
        ${peopleList(trip)}
        <form id="person-form" class="row">
          <label class="sr" for="person-name">Name</label>
          <input id="person-name" name="name" type="text" required maxlength="40" autocomplete="off" placeholder="Name">
          <button type="submit">Add</button>
        </form>
        <p id="person-error" class="err" role="alert" aria-live="assertive" hidden></p>
      </section>
      <section class="block">
        <h2>${editing ? "Edit expense" : "Add expense"}</h2>
        ${expenseForm(trip, editing)}
      </section>
      <section class="block">
        <h2>Expenses</h2>
        ${expenseCards(trip)}
      </section>
      <section class="block">
        <h2>Balances</h2>
        ${balancesBlock(trip)}
      </section>
      <section class="block">
        <h2>Who pays whom</h2>
        ${settleBlock(trip)}
      </section>
      ${momentsSection()}
    </main>
  `;

  const banner = root.querySelector("#banner") as HTMLElement;
  const unequal = root.querySelector("#unequal") as HTMLInputElement | null;
  root.classList.toggle("show-weights", Boolean(unequal?.checked));
  unequal?.addEventListener("change", () => {
    root.classList.toggle("show-weights", unequal.checked);
  });

  async function copyWithFeedback(buttonId: string, label: string, value: string): Promise<void> {
    const btn = root.querySelector(`#${buttonId}`) as HTMLButtonElement | null;
    if (!btn) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      announce(`${label} copied`);
      const original = btn.textContent ?? label;
      btn.textContent = `${label} copied`;
      window.setTimeout(() => {
        btn.textContent = original;
      }, 2000);
    } catch {
      window.prompt(`Copy this ${label.toLowerCase()}`, value);
    }
  }

  root.querySelector("#copy-pin")?.addEventListener("click", () => {
    const pin = loadPhotoPin(id);
    if (!pin) {
      return;
    }
    void copyWithFeedback("copy-pin", "PIN", pin);
  });

  root.querySelector("#copy-link")?.addEventListener("click", () => {
    void copyWithFeedback("copy-link", "Link", window.location.href);
  });

  root.querySelector("#download-json")?.addEventListener("click", () => {
    const blob = new Blob([tripFileJson(trip)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "fairshare.json";
    link.click();
    URL.revokeObjectURL(href);
  });

  const personForm = root.querySelector("#person-form") as HTMLFormElement;
  const personError = root.querySelector("#person-error") as HTMLElement;
  personForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = personForm.elements.namedItem("name") as HTMLInputElement;
    try {
      const before = trip.people.length;
      const next = addPerson(trip, input.value);
      if (next.people.length === before) {
        setBanner(personError, "That person is already on the trip");
        return;
      }
      setBusy(root, true);
      const saved = await persist(id, next, banner);
      paint(root, id, saved, editingId);
    } catch (err) {
      if (!saveLock) {
        setBusy(root, false);
      }
      setBanner(personError, err instanceof Error ? err.message : "Could not add person");
    }
  });

  const expenseFormEl = root.querySelector("#expense-form") as HTMLFormElement | null;
  const expenseError = root.querySelector("#expense-error") as HTMLElement | null;
  expenseFormEl?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(expenseFormEl);
    const participants = data.getAll("participant").map(String);
    const useWeights = Boolean(unequal?.checked);
    try {
      let weights: number[] | undefined;
      if (useWeights) {
        weights = participants.map((person) => {
          const raw = String(data.get(`weight-${person}`) ?? "1");
          const value = Number.parseInt(raw, 10);
          if (!Number.isInteger(value) || value <= 0) {
            throw new Error("Weights must be positive whole numbers");
          }
          return value;
        });
      }
      const amountCents = parseAmount(String(data.get("amount") ?? ""));
      const input = {
        description: String(data.get("description") ?? ""),
        payer: String(data.get("payer") ?? ""),
        amount_cents: amountCents,
        participants,
        weights,
      };
      const editingExpenseId = expenseFormEl.dataset.editing;
      const next = editingExpenseId
        ? updateExpense(trip, editingExpenseId, input)
        : addExpense(trip, input, crypto.randomUUID());
      setBusy(root, true);
      const saved = await persist(id, next, banner);
      paint(root, id, saved);
    } catch (err) {
      if (!saveLock) {
        setBusy(root, false);
      }
      if (expenseError) {
        setBanner(expenseError, err instanceof Error ? err.message : "Could not save expense");
      }
    }
  });

  root.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const expenseId = button.dataset.edit;
      if (!expenseId) {
        return;
      }
      paint(root, id, trip, expenseId);
    });
  });

  root.querySelector("#cancel-edit")?.addEventListener("click", () => {
    paint(root, id, trip);
  });

  root.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((button) => {
    const description = button.getAttribute("aria-label")?.replace(/^Remove /, "") ?? "this expense";
    button.addEventListener("click", async () => {
      const expenseId = button.dataset.remove;
      if (!expenseId) {
        return;
      }
      if (!window.confirm(`Remove "${description}"?`)) {
        return;
      }
      try {
        const next = removeExpense(trip, expenseId);
        setBusy(root, true);
        const saved = await persist(id, next, banner);
        announce(`Removed "${description}"`);
        const stillEditing = editingId && expenseId !== editingId ? editingId : null;
        paint(root, id, saved, stillEditing);
      } catch (err) {
        if (!saveLock) {
          setBusy(root, false);
        }
        setBanner(banner, err instanceof Error ? err.message : "Could not remove expense");
      }
    });
  });

  bindMoments(root, id, trip);
}

export async function renderTrip(root: HTMLElement, id: string): Promise<void> {
  root.innerHTML = `<main class="page"><p class="muted">Loading trip…</p></main>`;
  try {
    const trip = await fetchTrip(id);
    rememberRecent(id, trip.name);
    paint(root, id, trip);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Trip not found";
    root.innerHTML = `
      <main class="page">
        <p class="err">${escapeHtml(message)}</p>
        <p><a href="/">Back to home</a></p>
      </main>
    `;
  }
}
