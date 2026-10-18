import Foundation
import PDFKit
import Vision
import AppKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8)); exit(1)
}
guard CommandLine.arguments.count == 2,
      let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else { fail("The PDF is damaged or unreadable.") }
guard !document.isLocked else { fail("Unlock this password-protected PDF before attaching it.") }
guard document.pageCount > 0, document.pageCount <= 1000 else { fail("PDFs must contain between 1 and 1,000 pages.") }
var pages: [String] = []
var ocrPages = 0
var extractedBytes = 0
for index in 0..<document.pageCount {
    do {
        let text = try autoreleasepool { () throws -> String in
            guard let page = document.page(at: index) else { fail("A PDF page could not be read.") }
            let embedded = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            // OCR every page without meaningful embedded text, including mixed PDFs.
            if embedded.filter({ $0.isLetter || $0.isNumber }).count >= 20 { return embedded }
            let bounds = page.bounds(for: .mediaBox)
            guard bounds.width > 0, bounds.height > 0 else { fail("A PDF page has invalid dimensions.") }
            let scale = min(3, 3000 / max(bounds.width, bounds.height))
            let image = page.thumbnail(of: NSSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
            var rect = CGRect(origin: .zero, size: image.size)
            guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { fail("A PDF page could not be rendered for OCR.") }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }
            // CPU processing is available offline and also works without a GPU session.
            request.usesCPUOnly = true
            try VNImageRequestHandler(cgImage: cgImage).perform([request])
            ocrPages += 1
            let recognized = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
            return recognized.isEmpty ? embedded : recognized
        }
        extractedBytes += text.utf8.count + 2
        guard extractedBytes <= 16 * 1024 * 1024 else { fail("Extracted text exceeds the 16 MB limit.") }
        pages.append(text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n"))
        let progress = try JSONSerialization.data(withJSONObject: ["page": index + 1, "pages": document.pageCount])
        FileHandle.standardError.write(progress + Data([10]))
    } catch { fail("On-device OCR failed. Try a clearer scan or retry extraction.") }
}
let text = pages.joined(separator: "\n\n")
guard text.utf8.count <= 16 * 1024 * 1024 else { fail("Extracted text exceeds the 16 MB limit.") }
var pageStartLines: [Int] = []
var nextLine = 1
for page in pages {
    pageStartLines.append(nextLine)
    nextLine += page.components(separatedBy: "\n").count + 1
}
// PDF outlines are explicit author-provided structure. Only attach an outline
// heading when its label can be anchored to an actual extracted line on that page.
var structuralNodes: [[String: Any]] = []
func normalizedHeading(_ value: String) -> String {
    return value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
}
func collectOutline(_ outline: PDFOutline, level: Int) {
    guard level <= 256 else { return }
    if let label = outline.label?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty,
       let page = outline.destination?.page {
        let pageIndex = document.index(for: page)
        if pageIndex >= 0 && pageIndex < pages.count {
            let target = normalizedHeading(label)
            let lines = pages[pageIndex].components(separatedBy: "\n")
            if let lineIndex = lines.firstIndex(where: { normalizedHeading($0) == target }) {
                structuralNodes.append(["text": label, "startLine": pageStartLines[pageIndex] + lineIndex, "level": min(6, max(1, level))])
            }
        }
    }
    for index in 0..<outline.numberOfChildren {
        if let child = outline.child(at: index) { collectOutline(child, level: level + 1) }
    }
}
if let root = document.outlineRoot {
    for index in 0..<root.numberOfChildren {
        if let child = root.child(at: index) { collectOutline(child, level: 1) }
    }
}
let output = try JSONSerialization.data(withJSONObject: ["text": text, "pages": document.pageCount, "ocrPages": ocrPages, "pageStartLines": pageStartLines, "structuralNodes": structuralNodes])
FileHandle.standardOutput.write(output)
