export function SourcePolicy({method}:{method?:'file'|'url'}) {
  return <p className="section-hint">{method==='url'
      ? 'Use a public HTTP or HTTPS URL for a web page, TXT, Markdown, or PDF, up to 50 MB. Web pages are saved as body text only, without scripts or embedded content. The source URL is saved with the entity.'
      : method==='file'
        ? 'TXT, MD, or PDF · up to 50 MB. The file and extracted text stay in this vault.'
        : 'Attach TXT, MD, or PDF files, or import a public HTTP or HTTPS URL · up to 50 MB. Web pages are saved as body text only, without scripts or embedded content. Original files, extracted text, and source URLs stay in this vault.'} Each source has one file or URL. Downloading, safety screening, PDF flattening, and text extraction run in the background after creation. The bell menu reports success or failure; failed sources remain inactive. On macOS, PDFs that fail screening are flattened into static pages and screened again before becoming available. Flattening removes interactive features and selectable text; OCR recovers the text locally. Password-locked or unreadable PDFs stay inactive.</p>;
}
