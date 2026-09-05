import { showQrDialog } from "../qr";
import { fetchTrip, saveTrip, type PublicTrip } from "../api";
import { getTheme, languageButtonHtml, nextLanguage, themeButtonHtml, toggleTheme } from "../theme";
import {
  addExpense,
  addPerson,
  centsToEuro,
  movePerson,
  renamePerson,
  computeBalances,
  parseAmount,
  removeExpense,
  settle,
  t,
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
    return `<p class="muted">${t("Add the people who are sharing expenses.")}</p>`;
  }
  return `<ul class="people">${trip.people
    .map(
      (p, index) =>
        `<li><span class="person-name">${escapeHtml(p)}</span>` +
        ` <button type="button" class="text-btn" data-rename-person="${escapeHtml(p)}" aria-label="${t("Rename {{name}}", { name: escapeHtml(p) })}">${t("Rename")}</button>` +
        (index > 0 ? ` <button type="button" class="text-btn" data-move-person="${escapeHtml(p)}" data-direction="up" aria-label="${t("Move {{name}} up", { name: escapeHtml(p) })}">↑</button>` : "") +
        (index < trip.people.length - 1
          ? ` <button type="button" class="text-btn" data-move-person="${escapeHtml(p)}" data-direction="down" aria-label="${t("Move {{name}} down", { name: escapeHtml(p) })}">↓</button>`
          : "") +
        `</li>`,
    )
    .join("")}</ul>`;
}

function expenseCards(trip: Trip): string {
  if (trip.expenses.length === 0) {
    return `<p class="muted">${t("No expenses yet. Add one above.")}</p>`;
  }
  return `<ul class="expenses">${trip.expenses
    .map((e) => {
      const weights =
        e.weights !== undefined
          ? ` · ${t("weights")} ${escapeHtml(e.weights.join(":"))}`
          : "";
          return `<li>
        <div>
          <strong>${escapeHtml(e.description)}</strong>
          <span class="meta">${escapeHtml(e.payer)} ${t("paid")} ${centsToEuro(e.amount_cents)} · ${escapeHtml(e.participants.join(", "))}${weights}</span>
        </div>
        <div class="expense-actions">
          <button type="button" class="text-btn" data-edit="${escapeHtml(e.id)}" aria-label="${t("Edit {{description}}", { description: escapeHtml(e.description) })}">${t("Edit")}</button>
          <button type="button" class="text-btn" data-remove="${escapeHtml(e.id)}" aria-label="${t("Remove {{description}}", { description: escapeHtml(e.description) })}">${t("Remove")}</button>
        </div>
      </li>`;
    })
    .join("")}</ul>`;
}

function balancesBlock(trip: Trip): string {
  if (trip.expenses.length === 0) {
    return `<p class="muted">${t("No expenses recorded. Add expenses to see who owes what.")}</p>`;
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
  return `<p class="muted explainer">${t("Positive = owed to this person. Negative = this person owes money.")}</p><ul class="ledger">${rows}</ul>`;
}

function settleBlock(trip: Trip): string {
  if (trip.expenses.length === 0) {
    return `<p class="muted">${t("Add expenses to see who pays whom.")}</p>`;
  }
  const payments = settle(computeBalances(trip));
  if (payments.length === 0) {
    return `<p class="muted">${t("All settled — no payments needed.")}</p>`;
  }
  return `<ul class="payments">${payments
    .map(
      (p) =>
        `<li>${escapeHtml(p.frm)} → ${escapeHtml(p.to)} <strong>${centsToEuro(p.amount_cents)}</strong>` +
        `<button type="button" class="text-btn" data-share-from="${escapeHtml(p.frm)}" data-share-to="${escapeHtml(p.to)}" data-share-amount="${p.amount_cents}" aria-label="${t("Copy payment: {{from}} pays {{to}} {{amount}}", { from: escapeHtml(p.frm), to: escapeHtml(p.to), amount: centsToEuro(p.amount_cents) })}">${t("Share")}</button></li>`,
    )
    .join("")}</ul>`;
}

function centsToFormAmount(cents: number): string {
  const abs = Math.abs(cents);
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function chipInputId(prefix: string, person: string): string {
  return `${prefix}-${encodeURIComponent(person)}`;
}

function expenseForm(trip: Trip, editing: Expense | null): string {
  if (trip.people.length === 0) {
    return "";
  }
  const participantSet = new Set(editing?.participants ?? trip.people);

  const defaultPayer = editing?.payer ?? trip.people[0];
  const payerChips = trip.people
    .map((p) => {
      const checked = p === defaultPayer ? " checked" : "";
      const id = chipInputId("payer", p);
      return `
        <input type="radio" name="payer" id="${id}" value="${escapeHtml(p)}" required class="chip-input"${checked}>
        <label for="${id}" class="chip">${escapeHtml(p)}</label>`;
    })
    .join("");

  const splitChips = trip.people
    .map((p) => {
      const checked = participantSet.has(p) ? " checked" : "";
      const id = chipInputId("participant", p);
      return `
        <input type="checkbox" name="participant" id="${id}" value="${escapeHtml(p)}" class="chip-input"${checked}>
        <label for="${id}" class="chip">${escapeHtml(p)}</label>`;
    })
    .join("");

  const weightRows = trip.people
    .map((p) => {
      const weightIndex = editing?.participants.indexOf(p) ?? -1;
      const weight =
        editing?.weights !== undefined && weightIndex >= 0
          ? String(editing.weights[weightIndex])
          : "1";
      const id = chipInputId("weight", p);
      return `
        <div class="weight-row">
          <label for="${id}">${escapeHtml(p)}</label>
          <input type="number" id="${id}" name="weight-${escapeHtml(p)}" min="0" step="1" value="${escapeHtml(weight)}" class="weight" inputmode="numeric">
        </div>`;
    })
    .join("");

  const desc = editing ? escapeHtml(editing.description) : "";
  const amount = editing ? escapeHtml(centsToFormAmount(editing.amount_cents)) : "";
  const unequal = editing?.weights !== undefined ? " checked" : "";
  const submitLabel = editing ? t("Save expense") : t("Add expense");
  const editingAttr = editing ? ` data-editing="${escapeHtml(editing.id)}"` : "";
  const cancel = editing
    ? `<button type="button" class="text-btn" id="cancel-edit">${t("Cancel")}</button>`
    : "";

  return `
    <form id="expense-form" class="stack"${editingAttr}>
      <label for="exp-desc">${t("Description")}</label>
      <input id="exp-desc" name="description" type="text" required maxlength="120" autocomplete="off" value="${desc}">
      <label for="exp-amount">${t("Amount (€)")}</label>
      <input id="exp-amount" name="amount" type="text" inputmode="decimal" required placeholder="${t("60 or 60.50")}" value="${amount}">

      <fieldset class="chip-fieldset">
        <legend>${t("Who paid")}</legend>
        <div class="chip-row" role="radiogroup" aria-required="true">
          ${payerChips}
        </div>
      </fieldset>

      <fieldset class="chip-fieldset">
        <legend>${t("Split between")}</legend>
        <div class="chip-row">
          ${splitChips}
        </div>
      </fieldset>

      <div class="weight-toggle">
        <label class="check">
          <input type="checkbox" id="unequal" name="unequal"${unequal}>
          <span>${t("Split by shares")}</span>
        </label>
        <p class="muted small" id="weight-help">${t("If selected, give each person an integer share. Use 1 for an equal share, 2 for twice as much, etc.")}</p>
      </div>

      <div class="weight-list" id="weight-list">
        ${weightRows}
      </div>

      <p id="expense-error" class="err" role="alert" aria-live="assertive" hidden></p>
      <button type="submit">${submitLabel}</button>
      ${cancel}
    </form>
  `;
}

function paint(root: HTMLElement, id: string, trip: PublicTrip, editingId: string | null = null): void {
  const hasPin = Boolean(loadPhotoPin(id));
  const themeLabel = getTheme() === "dark" ? t("Light") : t("Dark");
  const editing = editingId ? trip.expenses.find((e) => e.id === editingId) ?? null : null;
  root.innerHTML = `
    <header class="topbar">
      <div>
        <p class="kicker"><a href="/">${t("Fair Share")}</a></p>
        <h1>${escapeHtml(trip.name)}</h1>
      </div>
      <div class="topbar-actions">
        <button type="button" id="copy-pin" ${hasPin ? "" : "hidden"} title="${t("Copy the 6-digit PIN for the trip photos")}">${t("Copy PIN")}</button>
        <button type="button" id="copy-link" title="${t("Copy the trip link to share")}">${t("Copy link")}</button>
        <button type="button" id="show-qr" title="${t("Show a QR code for the trip link")}">${t("Show QR")}</button>
        <button type="button" id="download-json" title="${t("Download the trip as a JSON file")}">${t("Download JSON")}</button>
        ${languageButtonHtml()}
        ${themeButtonHtml(themeLabel)}
      </div>
    </header>
    <p id="banner" class="err" role="alert" aria-live="assertive" hidden></p>
    <main class="page trip">
      <section class="block">
        <h2>${t("People")}</h2>
        ${peopleList(trip)}
        <form id="person-form" class="row">
          <label class="sr" for="person-name">${t("Name")}</label>
          <input id="person-name" name="name" type="text" required maxlength="40" autocomplete="off" placeholder="${t("Name")}">
          <button type="submit">${t("Add")}</button>
        </form>
        <p id="person-error" class="err" role="alert" aria-live="assertive" hidden></p>
      </section>
      <section class="block">
        <h2>${editing ? t("Edit expense") : t("Add expense")}</h2>
        ${expenseForm(trip, editing)}
      </section>
      <section class="block">
        <h2>${t("Expenses")}</h2>
        ${expenseCards(trip)}
      </section>
      <section class="block">
        <h2>${t("Balances")}</h2>
        ${balancesBlock(trip)}
      </section>
      <section class="block">
        <h2>${t("Who pays whom")}</h2>
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
      announce(t("{{label}} copied", { label }));
      const original = btn.textContent ?? label;
      btn.textContent = t("{{label}} copied", { label });
      window.setTimeout(() => {
        btn.textContent = original;
      }, 2000);
    } catch {
      window.prompt(t("Copy this {{label}}", { label: label.toLowerCase() }), value);
    }
  }

  root.querySelector("#copy-pin")?.addEventListener("click", () => {
    const pin = loadPhotoPin(id);
    if (!pin) {
      return;
    }
    void copyWithFeedback("copy-pin", t("PIN"), pin);
  });

  root.querySelector("#copy-link")?.addEventListener("click", () => {
    void copyWithFeedback("copy-link", t("Link"), window.location.href);
  });

  root.querySelector("#show-qr")?.addEventListener("click", () => {
    void showQrDialog(window.location.href);
  });

  const themeToggle = root.querySelector("#theme-toggle") as HTMLButtonElement | null;
  themeToggle?.addEventListener("click", () => {
    const next = toggleTheme();
    if (themeToggle) {
      themeToggle.textContent = next === "dark" ? t("Light") : t("Dark");
    }
  });

  const languageToggle = root.querySelector("#language-toggle") as HTMLButtonElement | null;
  languageToggle?.addEventListener("click", () => {
    nextLanguage();
    window.location.reload();
  });

  root.querySelectorAll<HTMLButtonElement>("[data-share-from]").forEach((button) => {
    button.addEventListener("click", async () => {
      const from = button.dataset.shareFrom ?? "";
      const to = button.dataset.shareTo ?? "";
      const amountCents = Number(button.dataset.shareAmount ?? "0");
      const message = t("{{from}} pays {{to}} {{amount}}", { from, to, amount: centsToEuro(amountCents) });
      try {
        await navigator.clipboard.writeText(message);
        announce(t("Payment copied"));
      } catch {
        window.prompt(t("Copy this payment"), message);
      }
    });
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
        setBanner(personError, t("That person is already on the trip"));
        return;
      }
      setBusy(root, true);
      const saved = await persist(id, next, banner);
      paint(root, id, saved, editingId);
    } catch (err) {
      if (!saveLock) {
        setBusy(root, false);
      }
      setBanner(personError, err instanceof Error ? err.message : t("Could not add person"));
    }
  });

  root.querySelector(".people")?.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (!button) {
      return;
    }
    const renamePersonName = button.getAttribute("data-rename-person");
    const movePersonName = button.getAttribute("data-move-person");
    const direction = button.getAttribute("data-direction") as "up" | "down" | null;
    if (renamePersonName) {
      const newName = window.prompt(t("New name for {{name}}", { name: renamePersonName }), renamePersonName);
      if (!newName || newName.trim() === renamePersonName) {
        return;
      }
      try {
        setBusy(root, true);
        const next = renamePerson(trip, renamePersonName, newName);
        const saved = await persist(id, next, banner);
        paint(root, id, saved, editingId);
      } catch (err) {
        if (!saveLock) {
          setBusy(root, false);
        }
        setBanner(personError, err instanceof Error ? err.message : t("Could not rename person"));
      }
    } else if (movePersonName && direction) {
      try {
        setBusy(root, true);
        const next = movePerson(trip, movePersonName, direction);
        const saved = await persist(id, next, banner);
        paint(root, id, saved, editingId);
      } catch (err) {
        if (!saveLock) {
          setBusy(root, false);
        }
        setBanner(personError, err instanceof Error ? err.message : t("Could not reorder people"));
      }
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
            throw new Error(t("Weights must be positive whole numbers"));
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
        setBanner(expenseError, err instanceof Error ? err.message : t("Could not save expense"));
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
    const description = button.getAttribute("aria-label")?.replace(new RegExp(`^${t("Remove")} `), "") ?? t("this expense");
    button.addEventListener("click", async () => {
      const expenseId = button.dataset.remove;
      if (!expenseId) {
        return;
      }
      if (!window.confirm(t('Remove "{{description}}"?', { description }))) {
        return;
      }
      try {
        const next = removeExpense(trip, expenseId);
        setBusy(root, true);
        const saved = await persist(id, next, banner);
        announce(t('Removed "{{description}}"', { description }));
        const stillEditing = editingId && expenseId !== editingId ? editingId : null;
        paint(root, id, saved, stillEditing);
      } catch (err) {
        if (!saveLock) {
          setBusy(root, false);
        }
        setBanner(banner, err instanceof Error ? err.message : t("Could not remove expense"));
      }
    });
  });

  bindMoments(root, id, trip);
}

export async function renderTrip(root: HTMLElement, id: string): Promise<void> {
  root.innerHTML = `<main class="page"><p class="muted">${t("Loading trip…")}</p></main>`;
  try {
    const trip = await fetchTrip(id);
    rememberRecent(id, trip.name);
    paint(root, id, trip);
  } catch (err) {
    const message = err instanceof Error ? err.message : t("Trip not found");
    root.innerHTML = `
      <main class="page">
        <p class="err">${escapeHtml(message)}</p>
        <p><a href="/">${t("Back to home")}</a></p>
      </main>
    `;
  }
}
