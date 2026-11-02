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

    // On phones the sidebar is a sticky bar across the top, so leave room for it.
    function goTo(q) {
      if (!q) return
      const header = document.querySelector(".sidebar.left")
      const box = header && header.getBoundingClientRect()
      const covers =
        box && getComputedStyle(header).position === "sticky" && box.width > window.innerWidth / 2
      q.el.style.scrollMarginTop = (covers ? box.height : 0) + 24 + "px"
      q.el.scrollIntoView({ behavior: "smooth", block: "start" })
      q.options[0].focus({ preventScroll: true })
    }

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

  function teardown() {
    if (!active) return
    active.abort.abort()
    active = null
  }

  document.addEventListener("nav", setup)
  if (window.addCleanup) setup()
})()
