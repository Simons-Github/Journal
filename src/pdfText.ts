/**
 * Text aus einer PDF-Datei lesen – komplett im Browser, die Datei wird nicht hochgeladen.
 * pdf.js wird erst beim ersten Import geladen, damit die App selbst klein bleibt.
 */
export async function pdfText(file: File, onPage?: (page: number, pages: number) => void): Promise<{ text: string; pages: number }> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  const parts: string[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      let line = ''
      const lines: string[] = []
      for (const item of content.items) {
        if (!('str' in item)) continue
        line += item.str
        if (item.hasEOL) { lines.push(line); line = '' }
        else if (item.str && !item.str.endsWith(' ')) line += ' '
      }
      if (line.trim()) lines.push(line)
      const text = lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
      if (text) parts.push(`--- ${n} ---\n${text}`)
      onPage?.(n, doc.numPages)
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return { text: parts.join('\n\n'), pages: doc.numPages }
}
