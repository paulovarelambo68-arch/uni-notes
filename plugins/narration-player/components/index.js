import fs from "node:fs"
import { h } from "preact"
import { joinSegments, pathToRoot, slugifyFilePath } from "@quartz-community/utils"

// Audio narration player, shown on notes whose frontmatter has a `narration` field (written by
// scripts/build-content.mjs from audio/<Subject>/<Note>.json). It sits under the title and docks
// to the bottom of the window once playing and scrolled past. Buttons jump by sentence (›) and
// by section (»); the timings come from the narration data embedded in the page.
// Behaviour: narration.inline.js. Styles: narration.css.
const css = fs.readFileSync(new URL("./narration.css", import.meta.url), "utf8")
const script = fs.readFileSync(new URL("./narration.inline.js", import.meta.url), "utf8")

const CHEVRON = "M8.6 5.4 7.2 6.8l5.2 5.2-5.2 5.2 1.4 1.4 6.6-6.6z"
const DOUBLE_CHEVRON =
  "M5.6 5.4 4.2 6.8l5.2 5.2-5.2 5.2 1.4 1.4 6.6-6.6zm7 0-1.4 1.4 5.2 5.2-5.2 5.2 1.4 1.4 6.6-6.6z"
const MINUS = "M6 11h12v2H6z"
const PLUS = "M11 6h2v5h5v2h-5v5h-2v-5H6v-2h5z"

const icon = (d, flip) =>
  h(
    "svg",
    { viewBox: "0 0 24 24", "aria-hidden": "true", class: flip ? "nar-flip" : undefined },
    h("path", { d }),
  )

const button = (cls, label, d, flip) =>
  h(
    "button",
    { class: `nar-btn ${cls}`, type: "button", "aria-label": label, title: label },
    icon(d, flip),
  )

const time = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

const NarrationComponent = ({ fileData, displayClass } = {}) => {
  const n = fileData?.frontmatter?.narration
  if (!n?.src || !n.sections?.length || !n.duration) return null
  const src = joinSegments(pathToRoot(fileData.slug), slugifyFilePath(n.src))
  const data = JSON.stringify({ duration: n.duration, sections: n.sections }).replace(
    /</g,
    "\\u003c",
  )
  const minutes = Math.max(1, Math.round(n.duration / 60))

  return h(
    "div",
    { class: (displayClass ? displayClass + " " : "") + "narration" },
    h("audio", { preload: "none", src }),
    h("script", {
      type: "application/json",
      class: "narration-data",
      dangerouslySetInnerHTML: { __html: data },
    }),
    h(
      "div",
      { class: "narration-bar", role: "region", "aria-label": "Audio narration" },
      h(
        "div",
        { class: "nar-controls" },
        button("nar-prev-section", "Previous section", DOUBLE_CHEVRON, true),
        button("nar-prev", "Previous sentence", CHEVRON, true),
        h(
          "button",
          {
            class: "nar-btn nar-play",
            type: "button",
            "aria-label": "Play narration",
            title: "Play",
          },
          h(
            "svg",
            { viewBox: "0 0 24 24", "aria-hidden": "true" },
            h("path", { class: "nar-icon-play", d: "M8 5.5v13l10.5-6.5z" }),
            h("path", { class: "nar-icon-pause", d: "M6.5 5h4v14h-4zm7 0h4v14h-4z" }),
          ),
        ),
        button("nar-next", "Next sentence", CHEVRON),
        button("nar-next-section", "Next section", DOUBLE_CHEVRON),
      ),
      h(
        "div",
        { class: "nar-main" },
        h(
          "div",
          { class: "nar-caption" },
          h(
            "button",
            { class: "nar-section", type: "button", title: "Play the narration" },
            "Listen to this note",
          ),
          h("span", { class: "nar-sentence" }, `${minutes} min · ${n.sections.length} sections`),
          h("span", { class: "nar-time" }, `0:00 / ${time(n.duration)}`),
        ),
        h(
          "div",
          {
            class: "nar-progress",
            role: "slider",
            tabindex: "0",
            "aria-label": "Position in the narration",
            "aria-valuemin": "0",
            "aria-valuemax": String(Math.round(n.duration)),
            "aria-valuenow": "0",
            "aria-valuetext": `0:00 of ${time(n.duration)}`,
          },
          h("div", { class: "nar-fill" }),
          ...n.sections.slice(1).map((s) =>
            h("span", {
              class: "nar-tick",
              style: `left:${((s.start / n.duration) * 100).toFixed(3)}%`,
            }),
          ),
        ),
      ),
      h(
        "div",
        { class: "nar-extra" },
        h(
          "div",
          { class: "nar-speed", role: "group", "aria-label": "Playback speed" },
          button("nar-slower", "Slower (−0.1×)", MINUS),
          h(
            "button",
            {
              class: "nar-speed-value",
              type: "button",
              "aria-label": "Speed 1.0×, reset to normal",
              title: "Reset to normal speed",
            },
            "1.0×",
          ),
          button("nar-faster", "Faster (+0.1×)", PLUS),
        ),
      ),
    ),
    n.credit?.text
      ? h(
          "p",
          { class: "nar-credit" },
          n.credit.url
            ? h("a", { href: n.credit.url, class: "external", rel: "noopener" }, n.credit.text)
            : n.credit.text,
        )
      : null,
  )
}

NarrationComponent.css = css
NarrationComponent.afterDOMLoaded = script

// The registry expects a constructor returning the component, like the other local plugins.
const NarrationPlayer = () => NarrationComponent

export { NarrationPlayer }
export default NarrationPlayer
