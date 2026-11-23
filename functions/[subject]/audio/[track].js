// Cloudflare Pages Function for the narration MP3s (/<subject>/audio/<track>.mp3).
//
// Pages' static asset server ignores HTTP Range requests and always sends the whole file,
// so the audio player could not seek, resume or "listen from here", and Safari refused to
// play at all. This answers Range requests with 206 Partial Content, streaming only the
// asked-for bytes. Only these paths run the function, so the rest of the site stays
// static (Functions on the free plan allow 100,000 requests a day).

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } })
  }

  let asset = await env.ASSETS.fetch(new Request(request.url))
  let size = Number(asset.headers.get("Content-Length"))
  const wantsRange = request.method === "GET" && request.headers.has("Range")
  if (asset.status === 200 && !size && wantsRange) {
    // The asset server sends Content-Length in production, but `wrangler pages dev`
    // streams without one: read the file to learn its size.
    const bytes = await asset.arrayBuffer()
    size = bytes.byteLength
    asset = new Response(bytes, asset)
  }
  const headers = new Headers(asset.headers)
  headers.set("Accept-Ranges", "bytes")

  const range = wantsRange ? parseRange(request.headers.get("Range"), size) : null
  if (asset.status !== 200 || !size || range === null) {
    // No (usable) Range header, or a HEAD request: the whole file, as before.
    if (request.method === "HEAD") asset.body?.cancel()
    return new Response(request.method === "HEAD" ? null : asset.body, {
      status: asset.status,
      headers,
    })
  }
  if (range === "invalid") {
    asset.body?.cancel()
    headers.set("Content-Range", `bytes */${size}`)
    headers.delete("Content-Length")
    return new Response(null, { status: 416, headers })
  }

  const [start, end] = range
  const length = end - start + 1
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`)
  headers.set("Content-Length", String(length))
  const out = new FixedLengthStream(length)
  slice(asset.body, start, end).pipeTo(out.writable).catch(() => {})
  return new Response(out.readable, { status: 206, headers })
}

// "bytes=a-b", "bytes=a-" or "bytes=-n". Returns [start, end] (inclusive), "invalid" when
// it can't be satisfied, or null for no header or a form we don't handle (several ranges).
function parseRange(header, size) {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === "" && m[2] === "")) return null
  let start, end
  if (m[1] === "") {
    const n = Number(m[2])
    if (n === 0) return "invalid"
    start = Math.max(size - n, 0)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start >= size || start > end) return "invalid"
  return [start, end]
}

// The bytes start..end (inclusive) of a stream, dropping the rest.
function slice(body, start, end) {
  const reader = body.getReader()
  let pos = 0
  return new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return ctrl.close()
        const at = pos
        pos += value.length
        if (pos <= start) continue
        ctrl.enqueue(value.subarray(Math.max(start - at, 0), Math.min(end + 1 - at, value.length)))
        if (pos > end) {
          ctrl.close()
          reader.cancel().catch(() => {})
        }
        return
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}
