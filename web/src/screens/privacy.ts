import { getLanguage, t } from "@fairshare/domain";
import { escapeHtml } from "../escape";
import { PRIVACY_COPY, PRIVACY_DPA_URL, PRIVACY_EMAIL } from "../privacy-copy";

export function privacyHtml(): string {
  const copy = PRIVACY_COPY[getLanguage()];
  const sections = copy.sections
    .map(
      (section) => `
      <section class="block">
        <h2>${escapeHtml(section.heading)}</h2>
        ${section.paragraphs.map((text) => `<p>${linkify(escapeHtml(text))}</p>`).join("")}
      </section>`,
    )
    .join("");
  return `
    <main class="page home privacy">
      <p class="kicker"><a href="./"><img src="icon.svg" alt="" class="brand-mark">${t("Fair Share")}</a></p>
      <h1>${escapeHtml(copy.title)}</h1>
      ${sections}
      <p class="footer-note">${escapeHtml(copy.complaintLead)}<a href="${PRIVACY_DPA_URL}" target="_blank" rel="noopener noreferrer">${PRIVACY_DPA_URL.replace("https://", "")}</a></p>
      <p class="muted footer-note">${escapeHtml(copy.updated)}</p>
      <p class="footer-note"><a href="./">${escapeHtml(copy.back)}</a></p>
    </main>
  `;
}

function linkify(escaped: string): string {
  return escaped.replace(PRIVACY_EMAIL, `<a href="mailto:${PRIVACY_EMAIL}">${PRIVACY_EMAIL}</a>`);
}

export function renderPrivacy(root: HTMLElement): void {
  root.innerHTML = privacyHtml();
}
