import { h } from "preact"

// Floating back button. Rendered on every page (fixed position, so the layout slot
// does not matter); the inline script shows it only on concept pages and wires the
// click + scroll restoration. Styling lives in quartz/styles/custom.scss.
const BackButtonComponent = ({ displayClass } = {}) =>
  h(
    "button",
    {
      class: (displayClass ? displayClass + " " : "") + "concept-back",
      type: "button",
      "aria-label": "Back to the note",
      title: "Back to the note",
    },
    h("span", { class: "concept-back-icon", "aria-hidden": "true" }),
  )

BackButtonComponent.afterDOMLoaded = `
const __bbPositions = {};
window.addEventListener("scroll", () => {
  __bbPositions[location.pathname] = window.scrollY;
}, { passive: true });

function __bbOnNav() {
  const onConceptPage = location.pathname.includes("/concepts/");
  document.documentElement.classList.toggle("bb-visible", onConceptPage);
  for (const btn of document.getElementsByClassName("concept-back")) {
    btn.style.display = onConceptPage ? "flex" : "none";
    if (!btn.dataset.bbBound) {
      btn.dataset.bbBound = "1";
      btn.addEventListener("click", () => history.back());
    }
  }
  // Restore the scroll position the page had when it was left (e.g. after history.back()).
  if (!location.hash) {
    const y = __bbPositions[location.pathname];
    if (y !== undefined && y > 0) {
      setTimeout(() => window.scrollTo(0, y), 60);
    }
  }
}
document.addEventListener("nav", __bbOnNav);
__bbOnNav();
`

// The registry expects a constructor returning the component (same shape the
// community plugins ship: `export const X = () => XComponent`).
const BackButton = () => BackButtonComponent

export { BackButton }
export default BackButton
