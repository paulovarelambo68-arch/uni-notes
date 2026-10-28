// No visible component: this plugin only carries an inline script. On a page load without a
// saved Explorer position, the Explorer calls scrollIntoView() on the open note, and that
// scrolls the page too, so a note opened in a new tab started a few hundred pixels down,
// past its title. The script keeps that scroll inside the Explorer's own list.
const ExplorerScrollComponent = () => null

// Before the DOM loads, so the patch is in place before the Explorer renders.
ExplorerScrollComponent.beforeDOMLoaded = `
const __esNative = Element.prototype.scrollIntoView
Element.prototype.scrollIntoView = function (options) {
  const list = this.closest(".explorer-ul")
  if (!list) return __esNative.call(this, options)
  const item = this.getBoundingClientRect()
  const box = list.getBoundingClientRect()
  if (item.top >= box.top && item.bottom <= box.bottom) return
  list.scrollTop += item.top - box.top - (box.height - item.height) / 2
}
`

// The registry expects a constructor returning the component (same shape the
// community plugins ship: `export const X = () => XComponent`).
const ExplorerScroll = () => ExplorerScrollComponent

export { ExplorerScroll }
export default ExplorerScroll
