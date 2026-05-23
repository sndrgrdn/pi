import type { App } from "./types";
import { getUi } from "./app";
import { el } from "./dom";
import { inputValue } from "./guards";
import { canSubmitReview } from "./reviewContract";
import type { ReviewDecision } from "./types";

function reviewLocked(app: App): boolean {
  const { state } = app;
  return state.submitting || state.submitted;
}

export function showReviewModal(app: App): void {
  const { state } = app;
  const ui = getUi(app);
  state.reviewOpen = true;
  ui.modalLayer.replaceChildren();
  const textarea = el("textarea", {
    autofocus: true,
    "aria-label": "Review summary",
    placeholder: "Overall feedback…",
    oninput: (e: Event) => { state.summary = inputValue(e); },
    onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" && e.metaKey) { e.preventDefault(); submitReview(app, "comment"); } },
  });
  textarea.value = state.summary;
  ui.modalLayer.append(
    el("div", { className: "modalBackdrop", onclick: () => hideReviewModal(app) },
      el("div", { className: "reviewModal", onclick: (e: Event) => e.stopPropagation() },
        el("header", {},
          el("h2", { textContent: "Submit review" }),
          el("p", { textContent: `${state.annotations.length} comment${state.annotations.length === 1 ? "" : "s"}` }),
        ),
        textarea,
        el("div", { className: "modalActions" },
          el("button", { className: "danger", type: "button", disabled: reviewLocked(app), onclick: () => submitReview(app, "request-changes") }, "Request changes"),
          el("button", { className: "approve", type: "button", disabled: reviewLocked(app), onclick: () => submitReview(app, "approve") }, "Approve"),
          el("button", { className: "primary", type: "button", disabled: reviewLocked(app), onclick: () => submitReview(app, "comment") }, "Submit"),
        ),
      ),
    ),
  );
  ui.modalLayer.style.display = "";
  textarea.focus();
}

export function hideReviewModal(app: App): void {
  const { state } = app;
  const ui = getUi(app);
  state.reviewOpen = false;
  ui.modalLayer.replaceChildren();
  ui.modalLayer.style.display = "none";
}

export function submitReview(app: App, decision: ReviewDecision): void {
  const { state, token } = app;
  const ui = getUi(app);
  if (!canSubmitReview({ decision, summary: state.summary, annotations: state.annotations })) {
    alert("Add a comment or summary first.");
    return;
  }
  state.submitting = true;
  ui.reviewButton.toggleAttribute("disabled", true);
  fetch(`/api/submit?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, summary: state.summary, annotations: state.annotations }),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      state.submitted = true;
      state.reviewOpen = false;
      hideReviewModal(app);
    })
    .catch((err) => alert(err instanceof Error ? err.message : String(err)))
    .finally(() => {
      state.submitting = false;
      ui.reviewButton.toggleAttribute("disabled", state.submitted);
      if (state.reviewOpen) showReviewModal(app);
    });
}
