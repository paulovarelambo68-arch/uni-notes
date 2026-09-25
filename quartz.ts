import fs from "fs"
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { componentRegistry } from "./quartz/components/registry"

// Sidebar order follows each subject's index note. scripts/build-content.mjs writes the
// ranks; the explorer runs its sort function in the browser, so the ranks are inlined
// into the function source rather than captured from a closure.
const orderFile = ".generated/explorer-order.json"
const order: Record<string, number> = fs.existsSync(orderFile)
  ? JSON.parse(fs.readFileSync(orderFile, "utf8"))
  : {}

const sortFn = new Function(
  "a",
  "b",
  `const order = ${JSON.stringify(order)}
  const ra = order[a.displayName], rb = order[b.displayName]
  if (ra !== undefined && rb !== undefined) return ra - rb
  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
  if (ra !== undefined) return -1
  if (rb !== undefined) return 1
  return a.displayName.localeCompare(b.displayName, undefined, { numeric: true, sensitivity: "base" })`,
)

// Attachments are not pages; keep them and the tags folder out of the sidebar.
const filterFn = (node: { slugSegment: string }) =>
  node.slugSegment !== "tags" && node.slugSegment !== "attachments"

componentRegistry.setOptionOverrides("@quartz-community/explorer", { sortFn, filterFn })

const config = await loadQuartzConfig()
export default config
export const layout = await loadQuartzLayout()
