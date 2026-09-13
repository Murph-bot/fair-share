import { showQrDialog } from "../qr";
import { deleteRemoteTrip, fetchTrip, saveTrip, type PublicTrip } from "../api";
import { getTheme, languageButtonHtml, nextLanguage, themeButtonHtml, toggleTheme } from "../theme";
import {
  addExpense,
  addPerson,
  archiveTrip,
  centsToCurrency,
  computeBalances,
  computeStats,
  effectiveAmountCents,
  movePerson,
  parseAmount,
  paymentStatus,
  recordPayment,
  removeExpense,
  renamePerson,
  settle,
  t,
  tripFileJson,
  unarchiveTrip,
  unrecordPayment,
  updateExpense,
  type Expense,
  type Trip,
} from "@fairshare/domain";
import { announce } from "../announce";
import { escapeHtml } from "../escape";
import { isOffline, onOfflineChange } from "../offline";
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

function expenseSearchableText(e: Expense): string {
  return [e.description, e.payer, e.category, e.note, e.participants.join(" ")]
    .filter((x): x is string => Boolean(x))
    .join(" ")
    .toLowerCase();
}

function expenseCards(trip: Trip): string {
  if (trip.expenses.length === 0) {
    return `<p class="muted">${t("No expenses yet. Add one above.")}</p>`;
  }
  const filterInput = `<label class="sr" for="expense-filter">${t("Search expenses")}</label>
    <input id="expense-filter" class="expense-filter" type="search" placeholder="${t("Search expenses")}" autocomplete="off">`;
  const sorted = [...trip.expenses].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return `${filterInput}<ul class="expenses">${sorted
    .map((e) => {
      const weights =
        e.weights !== undefined
          ? ` · ${t("weights")} ${escapeHtml(e.weights.join(":"))}`
          : "";
          const currency = e.currency ?? trip.currency ?? "EUR";
          const extras: string[] = [e.date, e.category, e.note].filter((x): x is string => Boolean(x));
          if (e.tax_cents !== undefined || e.tip_cents !== undefined) {
            extras.push(
              `${t("tax")} ${centsToCurrency(e.tax_cents ?? 0, currency)}${e.tip_cents !== undefined ? ` · ${t("tip")} ${centsToCurrency(e.tip_cents ?? 0, currency)}` : ""}`,
            );
          }
          const meta = [
            `${escapeHtml(e.payer)} ${t("paid")} ${centsToCurrency(e.amount_cents, currency)}`,
            ...(currency === (trip.currency ?? "EUR")
              ? []
              : [t("≈ {{amount}}", { amount: centsToCurrency(effectiveAmountCents(e), trip.currency ?? "EUR") })]),
            ...extras,
            `${escapeHtml(e.participants.join(", "))}${weights}`,
          ];
          return `<li data-search="${escapeHtml(expenseSearchableText(e))}">
        <div>
          <strong>${escapeHtml(e.description)}</strong>
          <span class="meta">${meta.join(" · ")}</span>
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
  const currency = trip.currency ?? "EUR";
  const rows = Object.keys(balances)
    .sort((a, b) => a.localeCompare(b))
    .map((person) => {
      const amount = balances[person];
      const sign = amount > 0 ? "+" : "";
      return `<li><span>${escapeHtml(person)}</span><span class="${amount < 0 ? "neg" : "pos"}">${sign}${centsToCurrency(amount, currency)}</span></li>`;
    })
    .join("");
  return `<p class="muted explainer">${t("Positive = owed to this person. Negative = this person owes money.")}</p><ul class="ledger">${rows}</ul>`;
}

function summaryHtml(trip: Trip): string {
  const currency = trip.currency ?? "EUR";
  const total = trip.expenses.reduce((sum, expense) => sum + effectiveAmountCents(expense), 0);
  const balances = computeBalances(trip);
  const balanceRows = Object.keys(balances)
    .sort((a, b) => a.localeCompare(b))
    .map((person) => {
      const amount = balances[person];
      const sign = amount > 0 ? "+" : "";
      return `<li><span>${escapeHtml(person)}</span><span>${sign}${centsToCurrency(amount, currency)}</span></li>`;
    })
    .join("");
  const expenseRows = trip.expenses
    .map(
      (expense) =>
        `<li><span>${escapeHtml(expense.description)}</span><span>${centsToCurrency(effectiveAmountCents(expense), currency)}</span></li>`,
    )
    .join("");
  return `
    <h1>${escapeHtml(trip.name)}</h1>
    <p class="muted">${t("Fair Share trip summary")} — ${new Date().toLocaleDateString()}</p>
    <p><strong>${t("Total")}: ${centsToCurrency(total, currency)}</strong> · ${t("{{count}} expenses", { count: String(trip.expenses.length) })} · ${escapeHtml(trip.people.join(", "))}</p>
    <h2>${t("Expenses")}</h2>
    <ul class="ledger">${expenseRows}</ul>
    <h2>${t("Balances")}</h2>
    <ul class="ledger">${balanceRows}</ul>
  `;
}

function summaryText(trip: Trip): string {
  const currency = trip.currency ?? "EUR";
  const total = trip.expenses.reduce((sum, expense) => sum + effectiveAmountCents(expense), 0);
  const balances = computeBalances(trip);
  const balanceLines = Object.keys(balances)
    .sort((a, b) => a.localeCompare(b))
    .map((person) => {
      const amount = balances[person];
      const sign = amount > 0 ? "+" : "";
      return `${person}: ${sign}${centsToCurrency(amount, currency)}`;
    })
    .join("\n");
  return [
    `${trip.name} — ${t("Fair Share trip summary")}`,
    `${t("Total")}: ${centsToCurrency(total, currency)}`,
    `${t("Expenses")} (${trip.expenses.length}):`,
    ...trip.expenses.map((expense) => `- ${expense.description}: ${centsToCurrency(effectiveAmountCents(expense), currency)}`),
    `${t("Balances")}:`,
    balanceLines,
  ].join("\n");
}

function statsBlock(trip: Trip): string {
  const stats = computeStats(trip);
  const currency = trip.currency ?? "EUR";
  const paidRows = Object.entries(stats.paidBy)
    .sort((a, b) => b[1] - a[1])
    .map(([person, amount]) => `<li><span>${escapeHtml(person)}</span><span>${centsToCurrency(amount, currency)}</span></li>`)
    .join("");
  const largest =
    stats.largestExpense !== null
      ? `<p class="muted">${t("Largest expense")}: <strong>${escapeHtml(stats.largestExpense.description)}</strong> (${centsToCurrency(effectiveAmountCents(stats.largestExpense), currency)})</p>`
      : "";
  return `
    <p><strong>${t("Total")}</strong>: ${centsToCurrency(stats.totalCents, currency)} · ${t("{{count}} expenses", { count: String(stats.expenseCount) })}</p>
    ${largest}
    <p class="muted">${t("Who paid")}</p>
    <ul class="ledger">${paidRows}</ul>
  `;
}

function settleBlock(trip: Trip): string {
  if (trip.expenses.length === 0) {
    return `<p class="muted">${t("Add expenses to see who pays whom.")}</p>`;
  }
  const payments = settle(computeBalances(trip));
  if (payments.length === 0) {
    return `<p class="muted">${t("All settled — no payments needed.")}</p>`;
  }
  const currency = trip.currency ?? "EUR";
  return `<ul class="payments">${payments
    .map((p) => {
      const status = paymentStatus(trip, p);
      const amountLabel = centsToCurrency(p.amount_cents, currency);
      const progress =
        status.paidCents > 0 && !status.completed
          ? ` <span class="muted">${t("Paid {{paid}} · {{remaining}} left", {
              paid: centsToCurrency(status.paidCents, currency),
              remaining: centsToCurrency(status.remainingCents, currency),
            })}</span>`
          : "";
      const shareButton = `<button type="button" class="text-btn" data-share-from="${escapeHtml(p.frm)}" data-share-to="${escapeHtml(p.to)}" data-share-amount="${p.amount_cents}" aria-label="${t("Copy payment: {{from}} pays {{to}} {{amount}}", { from: escapeHtml(p.frm), to: escapeHtml(p.to), amount: amountLabel })}">${t("Share")}</button>`;
      const recordAction = status.completed
        ? `<button type="button" class="text-btn" data-unrecord-payment data-from="${escapeHtml(p.frm)}" data-to="${escapeHtml(p.to)}" data-amount="${p.amount_cents}">${t("Unmark")}</button>`
        : `<button type="button" class="text-btn" data-record-payment data-from="${escapeHtml(p.frm)}" data-to="${escapeHtml(p.to)}" data-amount="${p.amount_cents}">${t("Mark as paid")}</button>` +
          `<button type="button" class="text-btn" data-partial-payment data-from="${escapeHtml(p.frm)}" data-to="${escapeHtml(p.to)}" data-amount="${p.amount_cents}">${t("Pay partial")}</button>`;
      return (
        `<li class="${status.completed ? "completed" : ""}">` +
        `<span class="payment-line">${escapeHtml(p.frm)} → ${escapeHtml(p.to)} <strong>${amountLabel}</strong>${progress}</span>` +
        `<span class="payment-actions">${shareButton}${recordAction}</span></li>`
      );
    })
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
  const date = editing?.date ? escapeHtml(editing.date) : "";
  const note = editing?.note ? escapeHtml(editing.note) : "";
  const category = editing?.category ? escapeHtml(editing.category) : "";
  const currency = editing?.currency ?? trip.currency ?? "EUR";
  const exchangeRate = editing?.exchange_rate ?? "";
  const taxCents = editing?.tax_cents ? escapeHtml(centsToFormAmount(editing.tax_cents)) : "";
  const tipCents = editing?.tip_cents ? escapeHtml(centsToFormAmount(editing.tip_cents)) : "";
  const unequal = editing?.weights !== undefined ? " checked" : "";
  const submitLabel = editing ? t("Save expense") : t("Add expense");
  const editingAttr = editing ? ` data-editing="${escapeHtml(editing.id)}"` : "";
  const cancel = editing
    ? `<button type="button" class="text-btn" id="cancel-edit">${t("Cancel")}</button>`
    : "";

  const categoryOptions = ["Food", "Transport", "Accommodation", "Entertainment", "Shopping", "Other"]
    .map((c) => `<option value="${escapeHtml(c)}"${category === c ? " selected" : ""}>${t(c)}</option>`)
    .join("");

  const currencyOptions = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "TRY", "JPY", "AUD", "CAD"]
    .map((c) => `<option value="${c}"${currency === c ? " selected" : ""}>${c}</option>`)
    .join("");

  return `
    <form id="expense-form" class="stack"${editingAttr}>
      <label for="exp-desc">${t("Description")}</label>
      <input id="exp-desc" name="description" type="text" required maxlength="120" autocomplete="off" value="${desc}">

      <label for="exp-amount">${t("Amount")}</label>
      <input id="exp-amount" name="amount" type="text" inputmode="decimal" required placeholder="${t("60 or 60.50")}" value="${amount}">

      <div class="row">
        <div>
          <label for="exp-currency">${t("Currency")}</label>
          <select id="exp-currency" name="currency" data-trip-currency="${escapeHtml(trip.currency ?? "EUR")}">
            ${currencyOptions}
          </select>
        </div>
        <div id="rate-field" ${currency === (trip.currency ?? "EUR") ? "hidden" : ""}>
          <label for="exp-rate">${t("Rate to {{currency}}", { currency: escapeHtml(trip.currency ?? "EUR") })}</label>
          <input id="exp-rate" name="exchange_rate" type="text" inputmode="decimal" placeholder="${t("e.g. 0.92")}" value="${exchangeRate}">
        </div>
      </div>
      <p class="muted small" id="rate-help" ${currency === (trip.currency ?? "EUR") ? "hidden" : ""}>${t("1 unit of this currency equals how much in {{currency}}?", { currency: escapeHtml(trip.currency ?? "EUR") })}</p>

      <div class="row">
        <div>
          <label for="exp-tax">${t("Tax")}</label>
          <input id="exp-tax" name="tax" type="text" inputmode="decimal" placeholder="0.00" value="${taxCents}">
        </div>
        <div>
          <label for="exp-tip">${t("Tip")}</label>
          <input id="exp-tip" name="tip" type="text" inputmode="decimal" placeholder="0.00" value="${tipCents}">
        </div>
      </div>
      <p class="muted small">${t("Tax and tip are added to the amount before splitting.")}</p>

      <div class="row">
        <div>
          <label for="exp-date">${t("Date")}</label>
          <input id="exp-date" name="date" type="date" value="${date}">
        </div>
        <div>
          <label for="exp-category">${t("Category")}</label>
          <select id="exp-category" name="category">
            <option value="">${t("Select category")}</option>
            ${categoryOptions}
          </select>
        </div>
      </div>

      <label for="exp-note">${t("Note")}</label>
      <textarea id="exp-note" name="note" rows="2" maxlength="200" placeholder="${t("Optional note")}">${note}</textarea>

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
        <p class="kicker"><a href="/"><img src="/icon.svg" alt="" class="brand-mark">${t("Fair Share")}</a></p>
        <h1>${escapeHtml(trip.name)}</h1>
      </div>
      <div class="topbar-actions">
        <button type="button" id="copy-pin" ${hasPin ? "" : "hidden"} title="${t("Copy the 6-digit PIN for the trip photos")}">${t("Copy PIN")}</button>
        <button type="button" id="copy-link" title="${t("Copy the trip link to share")}">${t("Copy link")}</button>
        <button type="button" id="show-qr" class="secondary" title="${t("Show a QR code for the trip link")}">${t("Show QR")}</button>
        <details class="more-actions">
          <summary>${t("More")}</summary>
          <div class="more-menu">
            <button type="button" id="download-json" title="${t("Download the trip as a JSON file")}">${t("Download JSON")}</button>
            <button type="button" id="share-summary" title="${t("Share a text summary of this trip")}">${t("Share summary")}</button>
            <button type="button" id="print-summary" title="${t("Print or save a summary of this trip")}">${t("Print summary")}</button>
            <button type="button" id="archive-trip" title="${trip.archivedAt ? t("Unarchive this trip") : t("Archive this trip")}">${trip.archivedAt ? t("Unarchive") : t("Archive")}</button>
            <button type="button" id="delete-trip" title="${t("Delete this trip forever")}">${t("Delete")}</button>
          </div>
        </details>
        ${languageButtonHtml()}
        ${themeButtonHtml(themeLabel)}
      </div>
    </header>
    <p id="banner" class="err" role="alert" aria-live="assertive" hidden></p>
    <p id="offline-banner" class="offline-banner" hidden>${t("You're offline — showing saved data.")}</p>
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
        <h2>${t("Overview")}</h2>
        ${statsBlock(trip)}
      </section>
      <section class="block">
        <h2>${t("Who pays whom")}</h2>
        ${settleBlock(trip)}
      </section>
      ${momentsSection()}
      <section class="block print-only" id="print-summary" aria-hidden="true">
        ${summaryHtml(trip)}
      </section>
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
      const message = t("{{from}} pays {{to}} {{amount}}", {
        from,
        to,
        amount: centsToCurrency(amountCents, trip.currency ?? "EUR"),
      });
      try {
        await navigator.clipboard.writeText(message);
        announce(t("Payment copied"));
      } catch {
        window.prompt(t("Copy this payment"), message);
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-record-payment]").forEach((button) => {
    button.addEventListener("click", async () => {
      const from = button.dataset.from ?? "";
      const to = button.dataset.to ?? "";
      const amountCents = Number(button.dataset.amount ?? "0");
      try {
        setBusy(root, true);
        const next = recordPayment(trip, { frm: from, to, amount_cents: amountCents });
        const saved = await persist(id, next, banner);
        paint(root, id, saved, editingId);
      } catch (err) {
        if (!saveLock) {
          setBusy(root, false);
        }
        setBanner(personError, err instanceof Error ? err.message : t("Could not mark payment"));
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-partial-payment]").forEach((button) => {
    button.addEventListener("click", async () => {
      const from = button.dataset.from ?? "";
      const to = button.dataset.to ?? "";
      const amountCents = Number(button.dataset.amount ?? "0");
      const status = paymentStatus(trip, { frm: from, to, amount_cents: amountCents });
      const raw = window.prompt(
        `${t("How much has {{from}} paid {{to}} so far?", { from, to })} (${centsToCurrency(status.paidCents, trip.currency ?? "EUR")} ${t("already paid")})`,
        centsToFormAmount(status.remainingCents),
      );
      if (raw === null) {
        return;
      }
      try {
        const partialCents = parseAmount(raw);
        if (partialCents > status.remainingCents) {
          setBanner(personError, t("Cannot pay more than what is owed"));
          return;
        }
        setBusy(root, true);
        const next = recordPayment(
          trip,
          { frm: from, to, amount_cents: amountCents },
          status.paidCents + partialCents,
        );
        const saved = await persist(id, next, banner);
        paint(root, id, saved, editingId);
      } catch (err) {
        if (!saveLock) {
          setBusy(root, false);
        }
        setBanner(personError, err instanceof Error ? err.message : t("Could not record payment"));
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-unrecord-payment]").forEach((button) => {
    button.addEventListener("click", async () => {
      const from = button.dataset.from ?? "";
      const to = button.dataset.to ?? "";
      const amountCents = Number(button.dataset.amount ?? "0");
      try {
        setBusy(root, true);
        const next = unrecordPayment(trip, { frm: from, to, amount_cents: amountCents });
        const saved = await persist(id, next, banner);
        paint(root, id, saved, editingId);
      } catch (err) {
        if (!saveLock) {
          setBusy(root, false);
        }
        setBanner(personError, err instanceof Error ? err.message : t("Could not unmark payment"));
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

  root.querySelector("#print-summary")?.addEventListener("click", () => {
    window.print();
  });

  root.querySelector("#share-summary")?.addEventListener("click", async () => {
    const text = summaryText(trip);
    try {
      if (navigator.share) {
        await navigator.share({ title: trip.name, text });
      } else {
        await navigator.clipboard.writeText(text);
        announce(t("Summary copied"));
      }
    } catch {
      /* user cancelled */
    }
  });

  root.querySelector("#archive-trip")?.addEventListener("click", async () => {
    try {
      setBusy(root, true);
      const next = trip.archivedAt ? unarchiveTrip(trip) : archiveTrip(trip);
      const saved = await persist(id, next, banner);
      paint(root, id, saved, editingId);
    } catch (err) {
      if (!saveLock) {
        setBusy(root, false);
      }
      setBanner(banner, err instanceof Error ? err.message : t("Could not archive trip"));
    }
  });

  root.querySelector("#delete-trip")?.addEventListener("click", async () => {
    if (!window.confirm(t("Delete this trip forever? This cannot be undone."))) {
      return;
    }
    try {
      setBusy(root, true);
      await deleteRemoteTrip(id);
      history.pushState({}, "", "/");
      window.dispatchEvent(new Event("fairshare:route"));
    } catch (err) {
      if (!saveLock) {
        setBusy(root, false);
      }
      setBanner(banner, err instanceof Error ? err.message : t("Could not delete trip"));
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
      const rawDate = String(data.get("date") ?? "").trim();
      const rawCategory = String(data.get("category") ?? "").trim();
      const rawNote = String(data.get("note") ?? "").trim();
      const rawCurrency = String(data.get("currency") ?? "").trim().toUpperCase();
      const expenseCurrency = rawCurrency || trip.currency || "EUR";
      const rawRate = String(data.get("exchange_rate") ?? "").trim();
      const tripCurrency = trip.currency ?? "EUR";
      const rawTax = String(data.get("tax") ?? "").trim();
      const rawTip = String(data.get("tip") ?? "").trim();
      const input = {
        description: String(data.get("description") ?? ""),
        payer: String(data.get("payer") ?? ""),
        amount_cents: amountCents,
        participants,
        weights,
        date: rawDate ? rawDate : undefined,
        category: rawCategory ? rawCategory : undefined,
        note: rawNote ? rawNote : undefined,
        currency: expenseCurrency === tripCurrency ? undefined : expenseCurrency,
        exchange_rate: expenseCurrency === tripCurrency || !rawRate ? undefined : rawRate,
        tax_cents: rawTax && Number(rawTax.replace(",", ".")) > 0 ? parseAmount(rawTax) : undefined,
        tip_cents: rawTip && Number(rawTip.replace(",", ".")) > 0 ? parseAmount(rawTip) : undefined,
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

  const currencySelect = root.querySelector("#exp-currency") as HTMLSelectElement | null;
  currencySelect?.addEventListener("change", () => {
    const tripCurrency = currencySelect.dataset.tripCurrency ?? "EUR";
    const rateField = root.querySelector("#rate-field") as HTMLElement | null;
    const rateHelp = root.querySelector("#rate-help") as HTMLElement | null;
    const foreign = currencySelect.value !== tripCurrency;
    if (rateField) {
      rateField.hidden = !foreign;
    }
    if (rateHelp) {
      rateHelp.hidden = !foreign;
    }
  });

  const filterInput = root.querySelector("#expense-filter") as HTMLInputElement | null;
  filterInput?.addEventListener("input", () => {
    const query = filterInput.value.trim().toLowerCase();
    root.querySelectorAll<HTMLLIElement>(".expenses li").forEach((item) => {
      const text = item.getAttribute("data-search") ?? "";
      item.style.display = !query || text.includes(query) ? "" : "none";
    });
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

  const offlineBanner = root.querySelector("#offline-banner") as HTMLElement | null;
  if (offlineBanner) {
    // paint() rebuilt the banner markup — restore live state on the new node.
    offlineBanner.hidden = !isOffline();
  }

  bindMoments(root, id, trip);
}

export async function renderTrip(root: HTMLElement, id: string): Promise<void> {
  root.innerHTML = `<main class="page"><p class="muted">${t("Loading trip…")}</p></main>`;
  try {
    const trip = await fetchTrip(id);
    rememberRecent(id, trip.name);
    paint(root, id, trip);
    const unsubscribe = onOfflineChange((offline) => {
      // paint() replaces the banner node — always query the live one.
      const banner = root.querySelector("#offline-banner") as HTMLElement | null;
      if (banner) {
        banner.hidden = !offline;
      }
    });
    window.addEventListener("fairshare:route", unsubscribe, { once: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : t("Trip not found");
    root.innerHTML = `
      <main class="page">
        <p class="err">${escapeHtml(message)}</p>
        <p><a href="/">${t("Back to home")}</a></p>
        <button type="button" id="reload-trip" class="secondary">${t("Try again")}</button>
      </main>
    `;
    root.querySelector("#reload-trip")?.addEventListener("click", () => {
      void renderTrip(root, id);
    });
    return;
  }
}
