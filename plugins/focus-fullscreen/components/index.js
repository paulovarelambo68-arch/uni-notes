// No visible component: this plugin only carries an inline script that puts the
// browser into real fullscreen (hiding its toolbar and tabs) while focus
// (reader) mode is on, and drops back out when the mode is turned off.
const FocusFullscreenComponent = () => null

FocusFullscreenComponent.afterDOMLoaded = `
function __fsEnter() {
  const el = document.documentElement
  if (document.fullscreenElement || document.webkitFullscreenElement) return
  try {
    const p = el.requestFullscreen
      ? el.requestFullscreen()
      : el.webkitRequestFullscreen && el.webkitRequestFullscreen()
    if (p && p.catch) p.catch(() => {})
  } catch (_) {}
}

function __fsExit() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement) return
  try {
    const p = document.exitFullscreen
      ? document.exitFullscreen()
      : document.webkitExitFullscreen && document.webkitExitFullscreen()
    if (p && p.catch) p.catch(() => {})
  } catch (_) {}
}

// The reader-mode button dispatches this synchronously from its click handler,
// so the fullscreen request still counts as a user gesture (browsers require one).
document.addEventListener("readermodechange", (e) => {
  if (e.detail && e.detail.mode === "on") __fsEnter()
  else __fsExit()
})

// Esc (or the OS-level fullscreen exit) leaves fullscreen without touching focus
// mode — sync the two states by turning focus mode off as well.
function __fsSyncBack() {
  if (
    !document.fullscreenElement &&
    !document.webkitFullscreenElement &&
    document.documentElement.getAttribute("reader-mode") === "on"
  ) {
    const btn = document.querySelector(".readermode")
    if (btn) btn.click()
  }
}
document.addEventListener("fullscreenchange", __fsSyncBack)
document.addEventListener("webkitfullscreenchange", __fsSyncBack)
`

// The registry expects a constructor returning the component (same shape the
// community plugins ship: `export const X = () => XComponent`).
const FocusFullscreen = () => FocusFullscreenComponent

export { FocusFullscreen }
export default FocusFullscreen
