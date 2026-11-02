import crypto from "node:crypto"

// Practice tests: a note with `type: test` in its frontmatter becomes a multiple-choice test
// that the reader takes in the browser. It is written as ordinary Markdown:
//
//   ### Which cells are first to arrive at a site of acute inflammation?
//   - [ ] Monocytes
//   - [x] Neutrophils
//   - [ ] B cells
//   > Explanation, shown once the question is answered.
//
// A heading whose section (up to the next heading or ---) holds a task list is a question: the
// heading is the question, anything between it and the list belongs to the question, the list
// items are the options ([x] marks the right ones; more than one makes it "select all that
// apply"), and whatever follows the list is the explanation. Other headings stay as they are and
// group the questions. Behaviour: components/practice-test.inline.js.

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

const h = (tagName, properties, children = []) => ({
  type: "element",
  tagName,
  properties: properties ?? {},
  children: children.filter(Boolean),
})
const text = (value) => ({ type: "text", value })

const isElement = (node, tag) => node?.type === "element" && (!tag || node.tagName === tag)
const isHeading = (node) => isElement(node) && /^h[1-6]$/.test(node.tagName)
const classes = (node) => [node.properties?.className ?? []].flat().map(String)
const isTaskList = (node) =>
  (isElement(node, "ul") || isElement(node, "ol")) && classes(node).includes("contains-task-list")
const isBlank = (node) => node.type === "text" && !node.value.trim()

function toText(node) {
  if (node.type === "text") return node.value
  return (node.children ?? []).map(toText).join("")
}

export function isTest(frontmatter) {
  return (
    String(frontmatter?.type ?? "")
      .trim()
      .toLowerCase() === "test"
  )
}

// What a button can't hold: blocks are left out of an option (with a warning), links are
// unwrapped to their text and checkboxes of nested task lists dropped.
const BLOCK =
  /^(ul|ol|pre|blockquote|div|table|section|figure|hr|details|iframe|video|audio|h[1-6])$/

// Copies of the nodes with only inline content left; `dropped` is set if a block was removed.
function inline(nodes, found) {
  return nodes.flatMap((node) => {
    if (!isElement(node)) return [node]
    if (BLOCK.test(node.tagName)) {
      found.dropped = true
      return []
    }
    if (node.tagName === "input") return []
    const children = inline(node.children ?? [], found)
    return node.tagName === "a" ? children : [{ ...node, children }]
  })
}

// An option: whether it's marked right ([x]; Obsidian's other task characters such as [-] or
// [/] are not), the character it's marked with, and its content for the answer button. Loose
// lists wrap items in paragraphs, which become line breaks. The note's own nodes are copied,
// not changed, since a list that turns out not to be a question is kept as written.
function option(li) {
  let checked = false
  const strip = (children) => {
    const out = children.filter((child) => {
      if (!isElement(child, "input") || child.properties?.type !== "checkbox") return true
      checked = Boolean(child.properties.checked)
      return false
    })
    if (out[0]?.type === "text") out[0] = { ...out[0], value: out[0].value.replace(/^\s+/, "") }
    return out
  }
  // In a tight list a lone space between two inline elements is part of the text; in a loose
  // one, whitespace only separates the paragraphs.
  const loose = li.children.some((child) => isElement(child, "p"))
  const parts = []
  for (const child of strip(li.children)) {
    if (loose && isBlank(child)) continue
    if (isElement(child, "p")) {
      if (parts.length) parts.push(h("br"))
      parts.push(...strip(child.children))
    } else {
      parts.push(child)
    }
  }
  const task = li.properties?.dataTask
  const mark = typeof task === "string" ? task.trim() : checked ? "x" : ""
  const found = { dropped: false }
  const children = inline(parts, found)
  return { correct: mark.toLowerCase() === "x", mark, children, dropped: found.dropped }
}

// Explanation blocks: a plain quote is unwrapped (the feedback box is already set apart);
// callouts and everything else are kept as written.
function explanation(nodes) {
  return nodes.flatMap((node) =>
    isElement(node, "blockquote") && !classes(node).includes("callout") ? node.children : [node],
  )
}

// Saved answers are keyed by a hash of the question's text, so editing a question forgets its
// answer. Identical questions get a numbered suffix.
function questionId(heading, options, used) {
  const answer = options.flatMap((o, i) => (o.correct ? [i] : []))
  const base = crypto
    .createHash("sha1")
    .update([toText(heading), ...options.map((o) => o.children.map(toText).join(""))].join("\n"))
    .update(`\n${answer}`)
    .digest("hex")
    .slice(0, 10)
  const n = (used.get(base) ?? 0) + 1
  used.set(base, n)
  return n === 1 ? base : `${base}-${n}`
}

// The generated markup uses divs, not p or li: custom.scss styles `article p` and `article li`,
// and being unlayered it beats this plugin's CSS whatever the specificity.
function question(heading, before, options, after, number, id) {
  const answer = options.flatMap((o, i) => (o.correct ? [i] : []))
  const multi = answer.length > 1
  heading.properties = { ...heading.properties, className: [...classes(heading), "pt-stem"] }
  const body = explanation(after).filter((n) => !isBlank(n))

  return h(
    "section",
    {
      className: ["pt-question"],
      dataPtId: id,
      dataPtAnswer: answer.join(" "),
    },
    [
      h("div", { className: ["pt-number"] }, [text(`Question ${number}`)]),
      heading,
      ...before,
      multi ? h("div", { className: ["pt-hint"] }, [text("Select all that apply.")]) : null,
      h(
        "div",
        {
          className: ["pt-options"],
          role: "group",
          ...(heading.properties.id
            ? { ariaLabelledby: heading.properties.id }
            : { ariaLabel: `Answers to question ${number}` }),
        },
        options.map((o, i) =>
          h("button", { type: "button", className: ["pt-option"], dataPtOption: String(i) }, [
            h("span", { className: ["pt-letter"] }, [text(LETTERS[i] ?? String(i + 1))]),
            h("span", { className: ["pt-text"] }, o.children),
          ]),
        ),
      ),
      multi
        ? h("button", { type: "button", className: ["pt-btn", "pt-check"], disabled: true }, [
            text("Check answer"),
          ])
        : null,
      h("div", { className: ["pt-status"], role: "status" }),
      // Styled as a callout; the script sets its colour and title once the question is answered.
      h("div", { className: ["callout", "pt-feedback"], dataCallout: "success", hidden: true }, [
        h("div", { className: ["callout-title"] }, [
          h("div", { className: ["callout-icon"] }),
          h("div", { className: ["callout-title-inner"] }, [h("p")]),
        ]),
        body.length ? h("div", { className: ["callout-content"] }, body) : null,
      ]),
    ],
  )
}

const actions = () =>
  h("div", { className: ["pt-actions"] }, [
    h("button", { type: "button", className: ["pt-btn", "pt-next"], hidden: true }, [
      text("Next unanswered"),
    ]),
    h("button", { type: "button", className: ["pt-btn", "pt-retry"], hidden: true }, [
      text("Retry wrong answers"),
    ]),
    h("button", { type: "button", className: ["pt-btn", "pt-reset"], hidden: true }, [
      text("Start again"),
    ]),
  ])

// GFM collects footnotes into a section at the end of the note. Kept out of the questions, or
// the last question's explanation would swallow (and hide) them.
const isFootnotes = (node) =>
  isElement(node, "section") &&
  (node.properties?.dataFootnotes !== undefined || classes(node).includes("footnotes"))

// Turns the note's top-level blocks into question cards, with a score bar above them and the
// result below. Returns the number of questions.
function buildTest(tree, warn) {
  const nodes = tree.children.filter((node) => !isFootnotes(node))
  const footnotes = tree.children.filter(isFootnotes)
  const out = []
  const used = new Map()
  let count = 0
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i]
    if (!isHeading(node)) {
      out.push(node)
      i++
      continue
    }
    let end = i + 1
    while (end < nodes.length && !isHeading(nodes[end]) && !isElement(nodes[end], "hr")) end++
    const section = nodes.slice(i + 1, end)
    i = end
    const at = section.findIndex(isTaskList)
    if (at < 0) {
      out.push(node, ...section)
      continue
    }
    const stem = `"${toText(node).trim()}"`
    const options = section[at].children.filter((c) => isElement(c, "li")).map(option)
    if (!options.some((o) => o.correct)) {
      warn(`${stem} has no option marked [x]; it stays a plain list`)
      out.push(node, ...section)
      continue
    }
    options.forEach((o, k) => {
      const letter = LETTERS[k] ?? String(k + 1)
      if (o.mark && !o.correct)
        warn(`${stem}: option ${letter} is marked [${o.mark}], read as wrong`)
      if (o.dropped) warn(`${stem}: option ${letter} has a list, quote or other block, left out`)
    })
    count++
    const id = questionId(node, options, used)
    out.push(question(node, section.slice(0, at), options, section.slice(at + 1), count, id))
  }
  if (count === 0) return 0

  const noun = count === 1 ? "question" : "questions"
  const bar = h("div", { className: ["pt-bar"], dataPtTotal: String(count) }, [
    h("div", { className: ["pt-progress"], ariaHidden: "true" }, [
      h("span", { className: ["pt-progress-right"] }),
      h("span", { className: ["pt-progress-wrong"] }),
    ]),
    h("div", { className: ["pt-tally"] }, [
      text(`${count} ${noun}. Choose an answer to see whether it's right.`),
    ]),
    actions(),
  ])
  // Not a live region: it changes on load too. The final score is announced with the verdict
  // of the last question answered.
  const results = h("section", { className: ["pt-results"], hidden: true }, [
    h("div", { className: ["pt-score"] }),
    actions(),
  ])
  // The bar goes under the note's introduction, right above the first heading.
  const first = out.findIndex((n) => isHeading(n) || classes(n).includes("pt-question"))
  out.splice(Math.max(first, 0), 0, bar)
  tree.children = [...out, results, ...footnotes]
  return count
}

export const PracticeTestTransformer = () => ({
  name: "PracticeTest",
  htmlPlugins() {
    return [
      () => (tree, file) => {
        if (!isTest(file.data.frontmatter)) return
        const where = file.data.slug ?? file.path ?? "a test note"
        const warn = (message) => console.warn(`Practice test ${where}: ${message}`)
        if (buildTest(tree, warn) === 0) warn("has `type: test` but no questions")
      },
    ]
  },
})
