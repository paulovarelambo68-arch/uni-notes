import fs from "node:fs"

// Practice tests. ../transformer.js turns notes with `type: test` into question cards at build
// time; this component renders nothing and only carries what runs them in the browser.
// Behaviour: practice-test.inline.js. Styles: practice-test.css.
const css = fs.readFileSync(new URL("./practice-test.css", import.meta.url), "utf8")
const script = fs.readFileSync(new URL("./practice-test.inline.js", import.meta.url), "utf8")

const PracticeTestComponent = () => null

PracticeTestComponent.css = css
PracticeTestComponent.afterDOMLoaded = script

// The registry expects a constructor returning the component, like the other local plugins.
const PracticeTest = () => PracticeTestComponent

export { PracticeTest }
export default PracticeTest
