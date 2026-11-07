// Practice test behaviour. Runs on every page; sets up the test when the page has one (the
// markup comes from plugins/practice-test/transformer.js). Answers are kept per page in
// localStorage["practice-test:<pathname>"], keyed by a hash of each question. The site is a
// single-page app, so this re-runs on every "nav" event and tears the previous test down in
// window.addCleanup (one listener, bound with an AbortController, since the page swap can
// reuse DOM elements).
;(() => {
  let active = null

  const store = {
    get(key) {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value)
      } catch {}
    },
    remove(key) {
      try {
        localStorage.removeItem(key)
      } catch {}
    },
  }
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s")
  const list = (items) =>
    items.length < 2 ? items.join("") : items.slice(0, -1).join(", ") + " and " + items.at(-1)

  function setup() {
    const bar = [...document.querySelectorAll(".pt-bar")].find(
      (el) => !el.closest(".popover, .search-space"),
    )
    if (!bar) return teardown()
    if (window.addCleanup) window.addCleanup(teardown)
    if (active && active.bar === bar && active.path === location.pathname) return
    teardown()

    const page = bar.parentElement
    if (bar.dataset.ptMode === "exam") {
      const abort = setupExam(bar, page)
      if (abort) active = { bar, path: location.pathname, abort }
      return
    }
    const key = "practice-test:" + location.pathname
    const read = (value) => {
      try {
        const answers = JSON.parse(value)
        return answers && typeof answers === "object" ? answers : {}
      } catch {
        return {}
      }
    }

    const questions = [...page.querySelectorAll(":scope > .pt-question")].map((el) => {
      const answer = el.dataset.ptAnswer.split(" ").filter(Boolean).map(Number)
      return {
        el,
        id: el.dataset.ptId,
        options: [...el.querySelectorAll(".pt-option")],
        answer,
        multi: answer.length > 1,
        picked: new Set(),
        done: false,
        check: el.querySelector(".pt-check"),
        status: el.querySelector(".pt-status"),
        feedback: el.querySelector(".pt-feedback"),
        verdict: el.querySelector(".pt-feedback .callout-title-inner > p"),
      }
    })
    if (questions.length === 0) return
    const byElement = new Map(questions.map((q) => [q.el, q]))
    const results = page.querySelector(":scope > .pt-results")
    const abort = new AbortController()

    const isRight = (q) =>
      q.done && q.picked.size === q.answer.length && q.answer.every((i) => q.picked.has(i))
    const letter = (q, i) => q.options[i].querySelector(".pt-letter").textContent

    function save() {
      const answers = {}
      for (const q of questions) if (q.done) answers[q.id] = [...q.picked]
      if (Object.keys(answers).length) store.set(key, JSON.stringify(answers))
      else store.remove(key)
    }

    // Saved answers (on load, or written by the same test in another tab). Indexes that don't
    // fit a question are ignored; a question not saved keeps any picks still being made.
    function load(answers) {
      for (const q of questions) {
        const kept = Array.isArray(answers[q.id]) ? answers[q.id] : []
        const picked = kept.filter((i) => Number.isInteger(i) && i >= 0 && i < q.options.length)
        if (picked.length) {
          q.picked = new Set(picked)
          q.done = true
        } else if (q.done) {
          q.picked = new Set()
          q.done = false
        }
        render(q, false)
      }
      tally()
    }

    function render(q, announce) {
      const right = isRight(q)
      q.el.classList.toggle("pt-done", q.done)
      q.options.forEach((btn, i) => {
        const picked = q.picked.has(i)
        const correct = q.answer.includes(i)
        btn.classList.toggle("pt-picked", picked)
        btn.classList.toggle("pt-right", q.done && correct)
        btn.classList.toggle("pt-wrong", q.done && picked && !correct)
        btn.setAttribute("aria-pressed", String(picked))
        if (q.done) btn.setAttribute("aria-disabled", "true")
        else btn.removeAttribute("aria-disabled")
      })
      if (q.check) {
        q.check.hidden = q.done
        q.check.disabled = q.picked.size === 0
      }
      q.feedback.hidden = !q.done
      if (!q.done) {
        q.status.textContent = ""
        return
      }
      const letters = q.answer.map((i) => letter(q, i))
      const verdict = right
        ? "Correct"
        : "Not quite: the answer" +
          (letters.length > 1 ? "s are " + list(letters) : " is " + letters[0])
      q.feedback.dataset.callout = right ? "success" : "failure"
      q.verdict.textContent = verdict
      if (announce) q.status.textContent = verdict + "."
    }

    function tally() {
      const total = questions.length
      const answered = questions.filter((q) => q.done).length
      const right = questions.filter(isRight).length
      const wrong = answered - right
      const left = total - answered
      bar.querySelector(".pt-progress-right").style.width = (100 * right) / total + "%"
      bar.querySelector(".pt-progress-wrong").style.width = (100 * wrong) / total + "%"
      bar.querySelector(".pt-tally").textContent =
        answered === 0
          ? plural(total, "question") + ". Choose an answer to see whether it's right."
          : answered + " of " + total + " answered · " + right + " right"
      const score =
        left === 0
          ? `You got ${right} out of ${total} right (${Math.round((100 * right) / total)}%).`
          : ""
      if (results) {
        results.hidden = answered === 0
        results.querySelector(".pt-score").textContent =
          score ||
          `${right} right out of ${answered} answered so far, ${plural(left, "question")} to go.`
      }
      for (const btn of page.querySelectorAll(":scope > * > .pt-actions > .pt-next"))
        btn.hidden = answered === 0 || left === 0
      for (const btn of page.querySelectorAll(":scope > * > .pt-actions > .pt-retry"))
        btn.hidden = wrong === 0
      for (const btn of page.querySelectorAll(":scope > * > .pt-actions > .pt-reset"))
        btn.hidden = answered === 0
      return score
    }

    const goTo = (q) => q && scrollToEl(q.el, q.options[0])

    // The question's verdict is announced, and with the last one the final score.
    function finish(q) {
      q.done = true
      save()
      render(q, true)
      const score = tally()
      if (score) q.status.textContent += " " + score
    }

    function choose(q, i) {
      if (q.done) return
      if (q.multi) {
        if (q.picked.has(i)) q.picked.delete(i)
        else q.picked.add(i)
        render(q, false)
        return
      }
      q.picked = new Set([i])
      finish(q)
    }

    function check(q) {
      if (q.done || q.picked.size === 0) return
      finish(q)
      q.options[0].focus({ preventScroll: true })
    }

    function clear(qs) {
      for (const q of qs) {
        q.picked = new Set()
        q.done = false
        render(q, false)
      }
      save()
      tally()
    }

    page.addEventListener(
      "click",
      (event) => {
        const btn = event.target.closest("button")
        if (!btn || !page.contains(btn) || btn.closest(".popover")) return
        const q = byElement.get(btn.closest(".pt-question"))
        if (btn.classList.contains("pt-option") && q) choose(q, Number(btn.dataset.ptOption))
        else if (btn.classList.contains("pt-check") && q) check(q)
        else if (btn.classList.contains("pt-next")) goTo(questions.find((q) => !q.done))
        else if (btn.classList.contains("pt-retry")) {
          const wrong = questions.filter((q) => q.done && !isRight(q))
          clear(wrong)
          goTo(wrong[0])
        } else if (btn.classList.contains("pt-reset")) {
          if (!confirm("Clear all your answers and start again?")) return
          clear(questions)
          goTo(questions[0])
        }
      },
      { signal: abort.signal },
    )
    // The same test open in another tab: follow its answers, so neither tab overwrites the other.
    window.addEventListener(
      "storage",
      (event) => {
        if (event.key === key || event.key === null) load(read(event.newValue))
      },
      { signal: abort.signal },
    )

    load(read(store.get(key)))
    active = { bar, path: location.pathname, abort }
  }

  // On phones the sidebar is a sticky bar across the top, so leave room for it.
  function scrollToEl(el, focus) {
    if (!el) return
    const header = document.querySelector(".sidebar.left")
    const box = header && header.getBoundingClientRect()
    const covers =
      box && getComputedStyle(header).position === "sticky" && box.width > window.innerWidth / 2
    el.style.scrollMarginTop = (covers ? box.height : 0) + 24 + "px"
    el.scrollIntoView({ behavior: "smooth", block: "start" })
    if (focus) focus.focus({ preventScroll: true })
  }

  // Exam mode (`mode: exam`): nothing is marked while the reader answers, and picks can change.
  // Finish marks every question, shows the score as an Irish honours band (University of Galway
  // bands) and lists the wrong answers with their explanations. Kept per page in
  // localStorage["practice-exam:<pathname>"] as { answers: { <id>: [indexes] }, finished }.
  const BANDS = [
    {
      min: 70,
      band: "first",
      label: "First Class Honours",
      say: [
        "Outstanding: that's a First. Skim the few you missed and you're ready.",
        "A First. Excellent work, so keep it this sharp on the day.",
        "First Class Honours. Your revision is clearly paying off.",
      ],
    },
    {
      min: 60,
      band: "upper-second",
      label: "Second Class Honours, Grade 1 (2.1)",
      say: [
        "A solid 2.1. Nail down the errors below and a First is within reach.",
        "Very good work. Go over your errors below to push into First territory.",
      ],
    },
    {
      min: 50,
      band: "lower-second",
      label: "Second Class Honours, Grade 2 (2.2)",
      say: [
        "A 2.2, on good foundations. Work through your errors below to climb a band.",
        "Over halfway there. Each explanation below is a quick win for next time.",
      ],
    },
    {
      min: 45,
      band: "third",
      label: "Third Class Honours",
      say: ["A Third, so you're over the line. The next band is close: start with the errors below."],
    },
    {
      min: 40,
      band: "pass",
      label: "Pass",
      say: ["A pass. The basics are there, so review the errors below and take it again."],
    },
    {
      min: 0,
      band: "fail",
      label: "Fail",
      say: [
        "Not there yet, and that's what a mock is for. Learn from each error below and try again.",
        "This one didn't go your way, but every mistake below is a lesson. Review them and retake it.",
      ],
    },
  ]

  function setupExam(bar, page) {
    const key = "practice-exam:" + location.pathname
    const questions = [...page.querySelectorAll(":scope > .pt-question")].map((el) => ({
      el,
      id: el.dataset.ptId,
      number: el.querySelector(".pt-number")?.textContent ?? "",
      stem: el.querySelector(".pt-stem")?.textContent.trim() ?? "",
      options: [...el.querySelectorAll(".pt-option")],
      answer: el.dataset.ptAnswer.split(" ").filter(Boolean).map(Number),
      picked: new Set(),
      explanation: el.querySelector(".pt-feedback > .callout-content"),
    }))
    const results = page.querySelector(":scope > .pt-results")
    if (questions.length === 0 || !results) return null
    const byElement = new Map(questions.map((q) => [q.el, q]))
    const grade = results.querySelector(".pt-grade")
    const review = results.querySelector(".pt-review")
    const note = results.querySelector(".pt-exam-note")
    const status = results.querySelector(".pt-status")
    const abort = new AbortController()
    let finished = false

    const isRight = (q) =>
      q.picked.size === q.answer.length && q.answer.every((i) => q.picked.has(i))
    const label = (q, i) => {
      const letter = q.options[i].querySelector(".pt-letter").textContent
      const words = q.options[i].querySelector(".pt-text")?.textContent.trim()
      return words ? letter + ". " + words : letter
    }
    const read = (value) => {
      try {
        const state = JSON.parse(value)
        return state && typeof state === "object" ? state : {}
      } catch {
        return {}
      }
    }

    function save() {
      const answers = {}
      for (const q of questions) if (q.picked.size) answers[q.id] = [...q.picked]
      if (finished || Object.keys(answers).length)
        store.set(key, JSON.stringify({ answers, finished }))
      else store.remove(key)
    }

    function load(state) {
      const answers = state.answers && typeof state.answers === "object" ? state.answers : {}
      for (const q of questions) {
        const kept = Array.isArray(answers[q.id]) ? answers[q.id] : []
        q.picked = new Set(kept.filter((i) => Number.isInteger(i) && i >= 0 && i < q.options.length))
      }
      finished = state.finished === true
      questions.forEach(render)
      update(false)
    }

    // Before Finish an option is only marked as chosen; after it, right and wrong as in a test.
    function render(q) {
      q.el.classList.toggle("pt-done", finished)
      q.options.forEach((btn, i) => {
        const picked = q.picked.has(i)
        const correct = q.answer.includes(i)
        btn.classList.toggle("pt-picked", picked)
        btn.classList.toggle("pt-right", finished && correct)
        btn.classList.toggle("pt-wrong", finished && picked && !correct)
        btn.setAttribute("aria-pressed", String(picked))
        if (finished) btn.setAttribute("aria-disabled", "true")
        else btn.removeAttribute("aria-disabled")
      })
    }

    function reviewItem(q) {
      const div = (className, ...children) => {
        const el = document.createElement("div")
        el.className = className
        el.append(...children)
        return el
      }
      const span = (className, words) => {
        const el = document.createElement("span")
        el.className = className
        el.textContent = words
        return el
      }
      const jump = document.createElement("button")
      jump.type = "button"
      jump.className = "pt-review-jump"
      jump.dataset.ptJump = String(questions.indexOf(q))
      jump.textContent = q.number
      const yours = q.picked.size
        ? [...q.picked].sort((a, b) => a - b).map((i) => label(q, i)).join("; ")
        : "not answered"
      const item = div(
        "pt-review-item",
        jump,
        div("pt-review-stem", q.stem),
        div(
          "pt-review-answers",
          span("pt-yours", "Your answer: " + yours),
          span("pt-correct", "Right answer: " + q.answer.map((i) => label(q, i)).join("; ")),
        ),
      )
      if (q.explanation)
        item.append(
          div("pt-review-explanation", ...[...q.explanation.childNodes].map((n) => n.cloneNode(true))),
        )
      return item
    }

    function update(announce) {
      const total = questions.length
      const answered = questions.filter((q) => q.picked.size).length
      const right = finished ? questions.filter(isRight).length : 0
      const pct = (100 * right) / total
      const shown = (Number.isInteger(pct) ? String(pct) : pct.toFixed(1)) + "%"
      const band = BANDS.find((b) => pct >= b.min)

      bar.classList.toggle("pt-finished", finished)
      bar.querySelector(".pt-progress-right").style.width =
        (100 * (finished ? right : answered)) / total + "%"
      bar.querySelector(".pt-progress-wrong").style.width = finished
        ? (100 * (total - right)) / total + "%"
        : "0%"
      bar.querySelector(".pt-tally").textContent = finished
        ? `Finished: ${right} of ${total} right (${shown}), ${band.label}.`
        : answered === 0
          ? plural(total, "question") + ". Answer them all, then press Finish to see your result."
          : `${answered} of ${total} answered. Press Finish when you're done.`
      for (const btn of page.querySelectorAll(":scope > * > .pt-actions > .pt-finish"))
        btn.hidden = finished
      for (const btn of page.querySelectorAll(":scope > * > .pt-actions > .pt-next"))
        btn.hidden = finished || answered === 0 || answered === total
      for (const btn of page.querySelectorAll(":scope > * > .pt-actions > .pt-reset"))
        btn.hidden = !finished && answered === 0
      note.hidden = finished
      grade.hidden = !finished
      review.hidden = !finished
      if (!finished) {
        review.querySelector(".pt-review-list").replaceChildren()
        status.textContent = ""
        return
      }
      const wrong = questions.filter((q) => !isRight(q))
      grade.dataset.band = band.band
      grade.querySelector(".pt-percent").textContent = shown
      grade.querySelector(".pt-band").textContent = band.label
      grade.querySelector(".pt-score").textContent = `${right} of ${total} right`
      grade.querySelector(".pt-message").textContent = band.say[right % band.say.length]
      review.querySelector(".pt-review-title").textContent = wrong.length
        ? `Your errors (${wrong.length})`
        : "No errors: every answer was right."
      review.querySelector(".pt-review-list").replaceChildren(...wrong.map(reviewItem))
      if (announce)
        status.textContent =
          `You scored ${shown}, ${band.label}. ` +
          (wrong.length ? plural(wrong.length, "error") + " to review below." : "No errors.")
    }

    function choose(q, i) {
      if (finished) return
      if (q.answer.length > 1) {
        if (q.picked.has(i)) q.picked.delete(i)
        else q.picked.add(i)
      } else q.picked = q.picked.has(i) ? new Set() : new Set([i])
      render(q)
      save()
      update(false)
    }

    function finish() {
      if (finished) return
      const left = questions.filter((q) => !q.picked.size).length
      if (
        left &&
        !confirm(
          `${plural(left, "question")} ${left === 1 ? "is" : "are"} still unanswered and will ` +
            "count as wrong. Finish anyway?",
        )
      )
        return
      finished = true
      save()
      questions.forEach(render)
      update(true)
      scrollToEl(results)
    }

    function retake() {
      if (!confirm("Clear your answers and take the exam again?")) return
      for (const q of questions) q.picked = new Set()
      finished = false
      save()
      questions.forEach(render)
      update(false)
      scrollToEl(questions[0].el, questions[0].options[0])
    }

    page.addEventListener(
      "click",
      (event) => {
        const btn = event.target.closest("button")
        if (!btn || !page.contains(btn) || btn.closest(".popover")) return
        const q = byElement.get(btn.closest(".pt-question"))
        if (btn.classList.contains("pt-option") && q) choose(q, Number(btn.dataset.ptOption))
        else if (btn.classList.contains("pt-finish")) finish()
        else if (btn.classList.contains("pt-reset")) retake()
        else if (btn.classList.contains("pt-next")) {
          const next = questions.find((q) => !q.picked.size)
          if (next) scrollToEl(next.el, next.options[0])
        } else if (btn.classList.contains("pt-review-jump")) {
          const target = questions[Number(btn.dataset.ptJump)]
          if (target) scrollToEl(target.el, target.options[0])
        }
      },
      { signal: abort.signal },
    )
    // The same exam open in another tab: follow it, so neither tab overwrites the other.
    window.addEventListener(
      "storage",
      (event) => {
        if (event.key === key || event.key === null) load(read(event.newValue))
      },
      { signal: abort.signal },
    )

    load(read(store.get(key)))
    return abort
  }

  function teardown() {
    if (!active) return
    active.abort.abort()
    active = null
  }

  document.addEventListener("nav", setup)
  if (window.addCleanup) setup()
})()
