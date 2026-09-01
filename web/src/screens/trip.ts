import { fetchTrip, saveTrip } from "../api";
import {
  addExpense,
  addPerson,
  centsToEuro,
  computeBalances,
  parseAmount,
  removeExpense,
  settle,
  type Trip,
} from "../domain";
import { escapeHtml } from "../escape";
import { rememberRecent } from "../recents";

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

async function persist(id: string, trip: Trip, banner: HTMLElement): Promise<Trip> {
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
    return `<p class="muted">Add at least one person before recording expenses.</p>`;
  }
  return `<ul class="people">${trip.people.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`;
}

function expenseCards(trip: Trip): string {
  if (trip.expenses.length === 0) {
    return `<p class="muted">No expenses yet.</p>`;
  }
  return `<ul class="expenses">${trip.expenses
    .map((e) => {
      const weights =
        e.weights !== undefined
          ? ` · weights ${e.weights.join(":")}`
          : "";
      return `<li>
        <div>
          <strong>${escapeHtml(e.description)}</strong>
          <span class="meta">${escapeHtml(e.payer)} paid ${centsToEuro(e.amount_cents)} · ${escapeHtml(e.participants.join(", "))}${weights}</span>
        </div>
        <button type="button" class="text-btn" data-remove="${escapeHtml(e.id)}">Remove</button>
      </li>`;
    })
    .join("")}</ul>`;
}

function balancesBlock(trip: Trip): string {
  if (trip.expenses.length === 0) {
    return `<p class="muted">No expenses recorded.</p>`;
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
  return `<ul class="ledger">${rows}</ul>`;
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

function expenseForm(trip: Trip): string {
  if (trip.people.length === 0) {
    return "";
  }
  const options = trip.people
    .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
    .join("");
  const checks = trip.people
    .map(
      (p) => `<label class="check">
        <input type="checkbox" name="participant" value="${escapeHtml(p)}" checked>
        <span>${escapeHtml(p)}</span>
        <input type="number" name="weight-${escapeHtml(p)}" min="1" step="1" value="1" class="weight" inputmode="numeric">
      </label>`,
    )
    .join("");
  return `
    <form id="expense-form" class="stack">
      <label for="exp-desc">Description</label>
      <input id="exp-desc" name="description" type="text" required maxlength="120" autocomplete="off">
      <label for="exp-amount">Amount (€)</label>
      <input id="exp-amount" name="amount" type="text" inputmode="decimal" required placeholder="60 or 60.50">
      <label for="exp-payer">Who paid</label>
      <select id="exp-payer" name="payer" required>${options}</select>
      <fieldset>
        <legend>Split between</legend>
        ${checks}
      </fieldset>
      <label class="check">
        <input type="checkbox" id="unequal" name="unequal">
        <span>Unequal shares (integer weights)</span>
      </label>
      <p id="expense-error" class="err" hidden></p>
      <button type="submit">Add expense</button>
    </form>
  `;
}

function paint(root: HTMLElement, id: string, trip: Trip): void {
  root.innerHTML = `
    <header class="topbar">
      <div>
        <p class="kicker"><a href="/">Fair share</a></p>
        <h1>${escapeHtml(trip.name)}</h1>
      </div>
      <button type="button" id="copy-link">Copy link</button>
    </header>
    <p id="banner" class="err" hidden></p>
    <main class="page trip">
      <section class="block">
        <h2>People</h2>
        ${peopleList(trip)}
        <form id="person-form" class="row">
          <label class="sr" for="person-name">Name</label>
          <input id="person-name" name="name" type="text" required maxlength="40" autocomplete="off" placeholder="Name">
          <button type="submit">Add</button>
        </form>
        <p id="person-error" class="err" hidden></p>
      </section>
      <section class="block">
        <h2>Add expense</h2>
        ${expenseForm(trip)}
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
    </main>
  `;

  const banner = root.querySelector("#banner") as HTMLElement;
  const unequal = root.querySelector("#unequal") as HTMLInputElement | null;
  root.classList.toggle("show-weights", Boolean(unequal?.checked));
  unequal?.addEventListener("change", () => {
    root.classList.toggle("show-weights", unequal.checked);
  });

  root.querySelector("#copy-link")?.addEventListener("click", async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      const btn = root.querySelector("#copy-link") as HTMLButtonElement;
      btn.textContent = "Copied";
    } catch {
      window.prompt("Copy this link", url);
    }
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
      paint(root, id, saved);
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
      const next = addExpense(
        trip,
        {
          description: String(data.get("description") ?? ""),
          payer: String(data.get("payer") ?? ""),
          amount_cents: amountCents,
          participants,
          weights,
        },
        crypto.randomUUID(),
      );
      setBusy(root, true);
      const saved = await persist(id, next, banner);
      paint(root, id, saved);
    } catch (err) {
      if (!saveLock) {
        setBusy(root, false);
      }
      if (expenseError) {
        setBanner(expenseError, err instanceof Error ? err.message : "Could not add expense");
      }
    }
  });

  root.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      const expenseId = button.dataset.remove;
      if (!expenseId) {
        return;
      }
      try {
        const next = removeExpense(trip, expenseId);
        setBusy(root, true);
        const saved = await persist(id, next, banner);
        paint(root, id, saved);
      } catch (err) {
        if (!saveLock) {
          setBusy(root, false);
        }
        setBanner(banner, err instanceof Error ? err.message : "Could not remove expense");
      }
    });
  });
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
