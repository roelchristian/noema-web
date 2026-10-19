import {DisclosureSummary} from '../components/DisclosureSummary';
export function SourcePolicy({method}:{method?:'file'|'url'}) {
  return <div className="source-policy">
    <p className="section-hint">{method==='url'
      ? 'Public web page, TXT, MD, or PDF URL · up to 50 MB.'
      : method==='file'
        ? 'TXT, MD, or PDF · up to 50 MB.'
        : 'One file or public URL per source · TXT, MD, or PDF · up to 50 MB.'} Processing runs in the background; check the bell menu for results.</p>
    <p className="section-hint">With Intelligence connected, source text is sent to OpenAI for enrichment. Automatic semantic indexing also sends extracted text for embeddings when enabled.</p>
    <details className="source-policy-details">
      <DisclosureSummary>Processing and storage details</DisclosureSummary>
      <p className="section-hint">Each source has one file or URL. Files, extracted text, and source URLs are stored in this vault. Web pages are saved as structured Markdown without running scripts or downloading embedded content.</p>
      <p className="section-hint">After extraction, AI generates a name, language, and summary of up to 75 words, and matches credited authors to people in your library or creates them. The original filename is preserved. Long sources may use excerpts for enrichment; indexing uses all extracted text.</p>
      <p className="section-hint">Sources are screened before use; failed sources stay inactive. On macOS, PDFs that fail screening are flattened and screened again. Flattening removes interactive features and selectable text; local OCR recovers text. Password-locked or unreadable PDFs stay inactive.</p>
    </details>
  </div>;
}
