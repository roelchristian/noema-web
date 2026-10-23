import {t as uiText} from '../i18n';
import {DisclosureSummary} from '../components/DisclosureSummary';
export function SourcePolicy({method}:{method?:'file'|'url'|'text'}) {
  return <div className="source-policy">
    <p className="section-hint">{method==='url'
      ? uiText("Public web page, TXT, MD, or PDF URL · up to 50 MB.")
      : method==='text'
        ? uiText("Pasted plain text · up to 16 MB in UTF-8.")
      : method==='file'
        ? uiText("TXT, MD, or PDF · up to 50 MB.")
        : uiText("One file, public URL, or pasted text per source · TXT, MD, or PDF · files up to 50 MB, pasted text up to 16 MB.")}{" " + uiText("Processing runs in the background; check the bell menu for results.")}</p>
    <p className="section-hint">{uiText("With Intelligence connected, source text is sent to OpenAI for enrichment. Automatic semantic indexing also sends extracted text for embeddings when enabled.")}</p>
    <details className="source-policy-details">
      <DisclosureSummary>{uiText("Processing and storage details")}</DisclosureSummary>
      <p className="section-hint">{uiText("Each source has one file, URL, or pasted text upload. Pasted text becomes a TXT file. Files, extracted text, and source URLs are stored in this vault. Web pages are saved as structured Markdown without running scripts or downloading embedded content.")}</p>
      <p className="section-hint">{uiText("After extraction, AI generates a name, language, and summary of up to 75 words, and matches credited authors to people in your library or creates them. The original filename is preserved. Long sources may use excerpts for enrichment; indexing uses all extracted text.")}</p>
      <p className="section-hint">{uiText("Sources are screened before use; failed sources stay inactive. On macOS, PDFs that fail screening are flattened and screened again. The original is preserved separately. Text and structure are extracted locally from that original; OCR is used when embedded text is insufficient. The safe viewing copy can lose interactive features and selectable text. Extraction evidence is available for comparison. Password-locked or unreadable PDFs stay inactive.")}</p>
    </details>
  </div>;
}
