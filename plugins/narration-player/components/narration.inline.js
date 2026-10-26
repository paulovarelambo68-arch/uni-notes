// Narration player behaviour. Runs on every page; sets up the player when the page has one.
// The site is a single-page app, so this re-runs on every "nav" event and tears the previous
// player down in window.addCleanup (listeners are bound with an AbortController because the
// page swap can reuse DOM elements).
;(() => {
  const SPEED_MIN = 0.5
  const SPEED_MAX = 3
  const SPEED_STEP = 0.1
  const RESTART_SENTENCE = 1.5 // seconds into a sentence after which "previous" restarts it
  const RESTART_SECTION = 3
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
  const time = (s) => {
    s = Math.max(0, Math.floor(s || 0))
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0")
  }
  const norm = (text) =>
    (text || "")
      .replace(/\s+/g, " ")
      .replace(/[:.]\s*$/, "")
      .trim()
      .toLowerCase()

  function setup() {
    const root = [...document.querySelectorAll(".narration")].find(
      (el) => !el.closest(".popover, .search-space"),
    )
    if (!root) return teardown()
    const audio = root.querySelector("audio")
    if (window.addCleanup) window.addCleanup(teardown)
    if (active && active.root === root && active.src === audio.src) return
    teardown()

    const data = JSON.parse(root.querySelector(".narration-data").textContent)
    const abort = new AbortController()
    const on = (el, type, fn, opts) =>
      el && el.addEventListener(type, fn, { ...opts, signal: abort.signal })
    const $ = (sel) => root.querySelector(sel)
    const bar = $(".narration-bar")
    const playBtn = $(".nar-play")
    const sectionEl = $(".nar-section")
    const sentenceEl = $(".nar-sentence")
    const progress = $(".nar-progress")
    const fill = $(".nar-fill")
    const timeEl = $(".nar-time")
    const speedValue = $(".nar-speed-value")
    const buttons = {
      slower: $(".nar-slower"),
      faster: $(".nar-faster"),
      prevSection: $(".nar-prev-section"),
      prev: $(".nar-prev"),
      next: $(".nar-next"),
      nextSection: $(".nar-next-section"),
    }

    const sections = data.sections
    const duration = data.duration
    const sentences = []
    sections.forEach((section, si) =>
      section.sentences.forEach((s) =>
        sentences.push({ start: s.start, text: s.text, section: si }),
      ),
    )
    const posKey = "narration:" + location.pathname
    let started = false
    let current = -1
    let currentSection = -1
    let lastSaved = 0
    let dragging = false

    // Parts of the note each section reads: a heading, a callout title or a list item's bold
    // label with the same text as the section title. Each gets a "listen from here" button,
    // placed where it can't open a gap in justified text: after the heading or callout title,
    // or at the end of the list item's own text.
    const article = document.querySelector("article")
    const targets = sections.map((section, i) => {
      if (i === 0 || !article) return null
      const want = norm(section.title)
      for (const el of article.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
        if (norm(el.textContent) === want) return { el, place: (btn) => el.append(btn) }
      }
      for (const el of article.querySelectorAll(".callout-title-inner")) {
        if (norm(el.textContent) === want)
          return { el: el.closest(".callout") || el, place: (btn) => el.after(btn) }
      }
      for (const el of article.querySelectorAll("li strong, p > strong")) {
        if (norm(el.textContent) !== want) continue
        const block = el.closest("p, li") || el
        return { el: el.closest("li") || block, place: (btn) => block.append(btn) }
      }
      return null
    })
    const jumpButtons = targets.map((target, i) => {
      if (!target) return null
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "narration-jump"
      btn.setAttribute("aria-label", "Listen from here: " + sections[i].title)
      btn.title = "Listen from here"
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5zm11.5 2.5a4 4 0 0 0-2.2-3.6v7.2a4 4 0 0 0 2.2-3.6zM13.3 4.2v2.1a6 6 0 0 1 0 11.4v2.1a8 8 0 0 0 0-15.6z"/></svg>'
      target.place(btn)
      on(btn, "click", (e) => {
        e.preventDefault()
        e.stopPropagation()
        seek(sections[i].start)
      })
      return btn
    })

    function indexAt(t) {
      let lo = 0
      let hi = sentences.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (sentences[mid].start <= t + 0.05) lo = mid
        else hi = mid - 1
      }
      return lo
    }

    function play() {
      if (!started) {
        started = true
        const saved = parseFloat(store.get(posKey))
        if (audio.currentTime < 0.5 && saved > 3 && saved < duration - 3) audio.currentTime = saved
      }
      audio.play().catch(() => {})
      dock()
    }

    function seek(t) {
      started = true
      audio.currentTime = Math.max(0, Math.min(duration - 0.05, t))
      update()
      play()
    }

    const actions = {
      prev() {
        const t = audio.currentTime
        const i = indexAt(t)
        seek(
          t - sentences[i].start > RESTART_SENTENCE || i === 0
            ? sentences[i].start
            : sentences[i - 1].start,
        )
      },
      next() {
        const i = indexAt(audio.currentTime)
        if (i + 1 < sentences.length) seek(sentences[i + 1].start)
      },
      prevSection() {
        const t = audio.currentTime
        const si = sentences[indexAt(t)].section
        seek(
          t - sections[si].start > RESTART_SECTION || si === 0
            ? sections[si].start
            : sections[si - 1].start,
        )
      },
      nextSection() {
        const si = sentences[indexAt(audio.currentTime)].section
        if (si + 1 < sections.length) seek(sections[si + 1].start)
      },
    }

    function update() {
      const t = audio.currentTime
      const i = indexAt(t)
      const si = sentences[i].section
      if (!dragging) setProgress(t)
      timeEl.textContent = time(t) + " / " + time(duration)
      if (started && i !== current) {
        current = i
        sentenceEl.textContent = sentences[i].text
      }
      if (started && si !== currentSection) {
        if (targets[currentSection])
          targets[currentSection].el.classList.remove("narration-current")
        currentSection = si
        sectionEl.textContent = sections[si].title
        sectionEl.title = "Show this part of the note"
        if (targets[si]) targets[si].el.classList.add("narration-current")
        if ("mediaSession" in navigator && window.MediaMetadata) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: document.title,
            artist: sections[si].title,
            album: "Study Notes",
          })
        }
      }
      buttons.next.disabled = i >= sentences.length - 1
      buttons.nextSection.disabled = si >= sections.length - 1
      if (started && Math.abs(t - lastSaved) > 2) savePosition()
    }

    function savePosition() {
      if (!started || audio.ended) return
      lastSaved = audio.currentTime
      store.set(posKey, String(audio.currentTime))
    }

    function setProgress(t) {
      fill.style.width = ((t / duration) * 100).toFixed(2) + "%"
      progress.setAttribute("aria-valuenow", String(Math.round(t)))
      progress.setAttribute("aria-valuetext", time(t) + " of " + time(duration))
    }

    function setPosition() {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: speed,
          position: Math.min(duration, audio.currentTime),
        })
      } catch {}
    }

    function setPlaying(playing) {
      root.classList.toggle("is-playing", playing)
      if (playing) setPosition()
      playBtn.setAttribute("aria-label", playing ? "Pause narration" : "Play narration")
      playBtn.title = playing ? "Pause" : "Play"
      if ("mediaSession" in navigator)
        navigator.mediaSession.playbackState = playing ? "playing" : "paused"
    }

    // Dock to the bottom of the window while the player's own spot is scrolled out of view.
    // It stays centred on the note's column, which the player's empty spot still spans.
    let inView = true
    function dock() {
      const docked = started && !inView
      if (docked && !bar.classList.contains("docked"))
        root.style.minHeight = root.offsetHeight + "px"
      if (docked) {
        const rect = root.getBoundingClientRect()
        bar.style.setProperty("--nar-center", rect.left + rect.width / 2 + "px")
        bar.style.setProperty("--nar-width", rect.width + "px")
      }
      bar.classList.toggle("docked", docked)
      if (!docked) root.style.minHeight = ""
    }
    on(window, "resize", dock, { passive: true })
    const observer =
      "IntersectionObserver" in window
        ? new IntersectionObserver((entries) => {
            inView = entries[entries.length - 1].isIntersecting
            dock()
          })
        : null
    if (observer) observer.observe(root)

    // Speed in steps of 0.1, remembered across notes.
    let speed = 1
    const setSpeed = (s) => {
      speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(s * 10) / 10))
      audio.playbackRate = speed
      speedValue.textContent = speed.toFixed(1) + "×"
      speedValue.setAttribute("aria-label", "Speed " + speed.toFixed(1) + "×, reset to normal")
      buttons.slower.disabled = speed <= SPEED_MIN
      buttons.faster.disabled = speed >= SPEED_MAX
      store.set("narration:speed", String(speed))
    }
    setSpeed(parseFloat(store.get("narration:speed")) || 1)

    // Seeking on the progress bar (click or drag; arrow keys move by sentence, shift by section).
    const fraction = (e) => {
      const rect = progress.getBoundingClientRect()
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    }
    on(progress, "pointerdown", (e) => {
      dragging = true
      progress.setPointerCapture(e.pointerId)
      setProgress(fraction(e) * duration)
    })
    on(progress, "pointermove", (e) => {
      if (dragging) setProgress(fraction(e) * duration)
    })
    on(progress, "pointerup", (e) => {
      if (!dragging) return
      dragging = false
      seek(fraction(e) * duration)
    })
    on(progress, "pointercancel", () => {
      dragging = false
      update()
    })
    on(progress, "keydown", (e) => {
      const keys = {
        ArrowRight: e.shiftKey ? actions.nextSection : actions.next,
        ArrowLeft: e.shiftKey ? actions.prevSection : actions.prev,
        Home: () => seek(0),
        End: () => seek(sections[sections.length - 1].start),
      }
      if (keys[e.key]) {
        e.preventDefault()
        keys[e.key]()
      }
    })

    on(playBtn, "click", () => (audio.paused ? play() : audio.pause()))
    on(buttons.prev, "click", actions.prev)
    on(buttons.next, "click", actions.next)
    on(buttons.prevSection, "click", actions.prevSection)
    on(buttons.nextSection, "click", actions.nextSection)
    on(buttons.slower, "click", () => setSpeed(speed - SPEED_STEP))
    on(buttons.faster, "click", () => setSpeed(speed + SPEED_STEP))
    on(speedValue, "click", () => setSpeed(1))
    on(sectionEl, "click", () => {
      if (!started) return play()
      const target = targets[currentSection]
      if (target) target.el.scrollIntoView({ behavior: "smooth", block: "center" })
      else if (started) window.scrollTo({ top: 0, behavior: "smooth" })
    })
    on(audio, "timeupdate", update)
    on(audio, "seeked", () => {
      update()
      setPosition()
    })
    on(audio, "play", () => setPlaying(true))
    on(audio, "pause", () => {
      setPlaying(false)
      savePosition()
    })
    on(window, "pagehide", savePosition)
    on(audio, "ended", () => {
      setPlaying(false)
      store.remove(posKey)
      audio.currentTime = 0
    })
    on(audio, "ratechange", () => {
      if (audio.playbackRate !== speed) audio.playbackRate = speed
      setPosition()
    })

    if ("mediaSession" in navigator) {
      const handlers = {
        play,
        pause: () => audio.pause(),
        previoustrack: actions.prev,
        nexttrack: actions.next,
        seekto: (details) => seek(details.seekTime),
      }
      for (const [name, fn] of Object.entries(handlers)) {
        try {
          navigator.mediaSession.setActionHandler(name, fn)
        } catch {}
      }
    }

    const saved = parseFloat(store.get(posKey))
    if (saved > 3 && saved < duration - 3) sentenceEl.textContent += " · resume at " + time(saved)

    active = {
      root,
      src: audio.src,
      stop() {
        savePosition()
        abort.abort()
        audio.pause()
        if (observer) observer.disconnect()
        jumpButtons.forEach((btn) => btn && btn.remove())
        targets.forEach((target) => target && target.el.classList.remove("narration-current"))
        bar.classList.remove("docked")
        root.style.minHeight = ""
        if ("mediaSession" in navigator) {
          for (const name of ["play", "pause", "previoustrack", "nexttrack", "seekto"]) {
            try {
              navigator.mediaSession.setActionHandler(name, null)
            } catch {}
          }
          navigator.mediaSession.metadata = null
          navigator.mediaSession.playbackState = "none"
        }
      },
    }
  }

  function teardown() {
    if (!active) return
    active.stop()
    active = null
  }

  document.addEventListener("nav", setup)
  if (window.addCleanup) setup()
})()
