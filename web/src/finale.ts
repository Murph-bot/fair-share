import { t } from "@fairshare/domain";

/** Pithelo family footer: privacy link and the giant "square." word. */
export function finaleHtml(withPrivacy = true): string {
  return `
    <footer class="finale">
      <div class="wrap">
        ${withPrivacy ? `<div class="cols"><a href="privacy">${t("Privacy")}</a></div>` : ""}
        <div class="big" aria-hidden="true">${t("square")}<i>.</i></div>
      </div>
    </footer>`;
}
