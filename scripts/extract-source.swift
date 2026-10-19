import Foundation
import PDFKit
import Vision
import AppKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8)); exit(1)
}
// Coverage decisions are deliberately geometric: OCR agreement is not proof of
// fidelity, and a retry must never silently replace a conflicting transcription.
struct OCRLine {
    let text: String
    let bounds: CGRect
    let confidence: Float
    let alternatives: [[String: Any]]
    let method: String
    var evidence: [String: Any] {
        ["text": text, "bounds": rectangle(bounds), "confidence": confidence, "alternatives": alternatives, "method": method]
    }
}
func rectangle(_ box: CGRect) -> [Double] { [Double(box.origin.x), Double(box.origin.y), Double(box.width), Double(box.height)] }
func intersectionArea(_ lhs: CGRect, _ rhs: CGRect) -> CGFloat {
    let overlap = lhs.intersection(rhs)
    return overlap.isNull || overlap.isEmpty ? 0 : overlap.width * overlap.height
}
func coverage(_ region: CGRect, by lines: [OCRLine]) -> CGFloat {
    guard region.width > 0, region.height > 0 else { return 0 }
    return min(1, lines.reduce(CGFloat(0)) { $0 + intersectionArea(region, $1.bounds) } / (region.width * region.height))
}
func uncoveredRegions(_ regions: [CGRect], lines: [OCRLine]) -> [CGRect] {
    var unique: [CGRect] = []
    for region in regions where region.width > 0.003 && region.height > 0.002 && coverage(region, by: lines) < 0.45 {
        if !unique.contains(where: { intersectionArea($0, region) > min($0.width * $0.height, region.width * region.height) * 0.5 }) { unique.append(region) }
    }
    return unique
}
func recognize(_ image: CGImage, region: CGRect = CGRect(x: 0, y: 0, width: 1, height: 1), correction: Bool = true) throws -> [OCRLine] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = correction
    request.minimumTextHeight = 0.003
    request.regionOfInterest = region
    if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }
    request.usesCPUOnly = true
    try VNImageRequestHandler(cgImage: image).perform([request])
    return (request.results ?? []).compactMap { observation in
        guard let best = observation.topCandidates(1).first else { return nil }
        let local = observation.boundingBox
        let global = CGRect(x: region.minX + local.minX * region.width, y: region.minY + local.minY * region.height, width: local.width * region.width, height: local.height * region.height)
        return OCRLine(text: best.string, bounds: global, confidence: best.confidence, alternatives: observation.topCandidates(3).map { ["text": $0.string, "confidence": $0.confidence] }, method: correction ? "ocr" : "region-retry")
    }
}
func canRecover(_ candidate: OCRLine, existing: [OCRLine], suspect: CGRect? = nil) -> Bool {
    let relevant = suspect.map { intersectionArea(candidate.bounds, $0) >= min(candidate.bounds.width * candidate.bounds.height, $0.width * $0.height) * 0.5 } ?? true
    return relevant && candidate.confidence >= 0.8 && !candidate.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && coverage(candidate.bounds, by: existing) < 0.15
}
func insertByPosition(_ candidate: OCRLine, into lines: inout [OCRLine]) {
    // Keep the established reading order, including multi-column order. Choose
    // the closest preceding line in the same horizontal band as the insertion.
    let aligned = lines.indices.filter { min(lines[$0].bounds.maxX, candidate.bounds.maxX) > max(lines[$0].bounds.minX, candidate.bounds.minX) }
    let preceding = aligned.filter { lines[$0].bounds.midY >= candidate.bounds.midY }.min { abs(lines[$0].bounds.midY - candidate.bounds.midY) < abs(lines[$1].bounds.midY - candidate.bounds.midY) }
    if let index = preceding { lines.insert(candidate, at: index + 1); return }
    let following = aligned.min { abs(lines[$0].bounds.midY - candidate.bounds.midY) < abs(lines[$1].bounds.midY - candidate.bounds.midY) }
    lines.insert(candidate, at: following ?? lines.count)
}
func nativeDuplicate(_ candidate: OCRLine, native: [OCRLine]) -> Bool {
    // Partial native overlays must never erase a longer scanned line.
    let normalized = candidate.text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    return coverage(candidate.bounds, by: native) >= 0.9 && native.contains { $0.text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") == normalized }
}
if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--test-coverage" {
    let known = OCRLine(text: "A known line", bounds: CGRect(x: 0.1, y: 0.8, width: 0.7, height: 0.02), confidence: 1, alternatives: [], method: "ocr")
    let missing = CGRect(x: 0.1, y: 0.76, width: 0.15, height: 0.02)
    precondition(uncoveredRegions([known.bounds, missing, missing], lines: [known]) == [missing])
    precondition(uncoveredRegions([CGRect(x: 0, y: 0, width: 0, height: 0)], lines: []).isEmpty)
    precondition(!canRecover(known, existing: [known]))
    precondition(canRecover(OCRLine(text: "Regan Arts.", bounds: missing, confidence: 0.99, alternatives: [], method: "region-retry"), existing: [known]))
    precondition(!canRecover(OCRLine(text: "uncertain", bounds: missing, confidence: 0.4, alternatives: [], method: "region-retry"), existing: [known]))
    precondition(!canRecover(known, existing: [], suspect: missing))
    let partial = OCRLine(text: "A known line with a scanned suffix", bounds: CGRect(x: 0.1, y: 0.8, width: 0.95, height: 0.02), confidence: 1, alternatives: [], method: "ocr")
    precondition(!nativeDuplicate(partial, native: [known]))
    precondition(nativeDuplicate(known, native: [known]))
    var ordered = [known, partial]
    insertByPosition(OCRLine(text: "New line", bounds: missing, confidence: 1, alternatives: [], method: "region-retry"), into: &ordered)
    precondition(ordered.filter { $0.text != "New line" }.map { $0.text } == [known.text, partial.text])
    print("coverage geometry, duplicate suppression, low-confidence review and safe recovery passed")
    exit(0)
}
guard CommandLine.arguments.count == 2,
      let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else { fail("The PDF is damaged or unreadable.") }
guard !document.isLocked else { fail("Unlock this password-protected PDF before attaching it.") }
guard document.pageCount > 0, document.pageCount <= 1000 else { fail("PDFs must contain between 1 and 1,000 pages.") }
var pages: [String] = []
var pageEvidence: [[String: Any]] = []
var ocrPages = 0
var extractedBytes = 0
for index in 0..<document.pageCount {
    do {
        let text = try autoreleasepool { () throws -> String in
            guard let page = document.page(at: index) else { fail("A PDF page could not be read.") }
            let embedded = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let pageBounds = page.bounds(for: .mediaBox)
            let nativeSelections = page.selection(for: pageBounds)?.selectionsByLine() ?? []
            let nativeCharacters = embedded.filter({ $0.isLetter || $0.isNumber }).count
            let nativeArea = nativeSelections.reduce(CGFloat(0)) { total, selection in
                let box = selection.bounds(for: page).intersection(pageBounds)
                return total + box.width * box.height
            }
            // A short embedded header is insufficient evidence that a scanned
            // body was extracted. Sparse native pages receive a coverage pass.
            let reliableNative = nativeCharacters >= 1000 || (nativeCharacters >= 200 && nativeArea >= pageBounds.width * pageBounds.height * 0.15)
            if reliableNative {
                let blocks = nativeSelections.map { selection -> [String: Any] in
                    let box = selection.bounds(for: page)
                    return ["text": selection.string ?? "", "bounds": rectangle(box)]
                }
                pageEvidence.append(["page": index + 1, "method": "native", "text": embedded, "blocks": blocks, "coordinateSystem": "pdf-points-bottom-left", "coverage": ["status": "native-text-not-raster-verified"], "findings": ["Embedded text preserved without OCR. Native text length does not verify coverage of any scanned or image-only regions; compare the page image if content appears missing."]])
                return embedded
            }
            let bounds = page.bounds(for: .mediaBox)
            guard bounds.width > 0, bounds.height > 0 else { fail("A PDF page has invalid dimensions.") }
            let scale = min(3, 3000 / max(bounds.width, bounds.height))
            let image = page.thumbnail(of: NSSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
            var rect = CGRect(origin: .zero, size: image.size)
            guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { fail("A PDF page could not be rendered for OCR.") }
            let started = Date()
            let initial = try recognize(cgImage)
            var lines = initial
            let nativeLines: [OCRLine] = nativeSelections.compactMap { selection in
                guard let text = selection.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
                let box = selection.bounds(for: page)
                return OCRLine(text: text, bounds: CGRect(x: (box.minX - bounds.minX) / bounds.width, y: (box.minY - bounds.minY) / bounds.height, width: box.width / bounds.width, height: box.height / bounds.height), confidence: 1, alternatives: [], method: "native")
            }
            if !nativeLines.isEmpty {
                lines = initial.filter { !nativeDuplicate($0, native: nativeLines) }
                for native in nativeLines { insertByPosition(native, into: &lines) }
            }
            ocrPages += 1
            let detector = VNDetectTextRectanglesRequest()
            detector.reportCharacterBoxes = true
            try VNImageRequestHandler(cgImage: cgImage).perform([detector])
            let detected = (detector.results ?? []).map { $0.boundingBox }
            let missing = uncoveredRegions(detected, lines: initial)
            let weak = initial.filter { $0.confidence < 0.6 }.map { $0.bounds }
            let suspects = missing.map { ($0, "unmatched-detected-text") } + weak.map { ($0, "low-confidence") }
            var regions: [[String: Any]] = []
            var recovered = 0, retried = 0
            var findings = ["OCR region coverage is checked automatically, not certified against the original. Review unresolved regions against the page image."]
            if !suspects.isEmpty {
                // Render once at higher resolution, then recognize only suspect
                // rectangles. At most twelve retries per page bound latency.
                let retryScale = min(5, 4500 / max(bounds.width, bounds.height))
                let retryImage = page.thumbnail(of: NSSize(width: bounds.width * retryScale, height: bounds.height * retryScale), for: .mediaBox)
                var retryRect = CGRect(origin: .zero, size: retryImage.size)
                let highResolution = retryImage.cgImage(forProposedRect: &retryRect, context: nil, hints: nil)
                for (regionIndex, suspect) in suspects.enumerated() {
                    let (box, reason) = suspect
                    var record: [String: Any] = ["bounds": rectangle(box), "reason": reason, "status": "unresolved"]
                    if regionIndex < 12, let bitmap = highResolution {
                        retried += 1
                        let crop = box.insetBy(dx: -0.012, dy: -0.004).intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
                        let candidates = (try? recognize(bitmap, region: crop, correction: false)) ?? []
                        record["candidates"] = candidates.map { $0.evidence }
                        var additions: [OCRLine] = []
                        for candidate in candidates where canRecover(candidate, existing: lines + additions, suspect: box) { additions.append(candidate) }
                        if !additions.isEmpty && reason == "unmatched-detected-text" {
                            for addition in additions { insertByPosition(addition, into: &lines) }
                            let resolved = coverage(box, by: additions) >= 0.45
                            if resolved { recovered += 1 }
                            record["status"] = resolved ? "recovered" : "review"
                            record["recoveredText"] = additions.map { $0.text }.joined(separator: " ")
                            record["confidence"] = additions.map { $0.confidence }.min() ?? 0
                        } else if !candidates.isEmpty {
                            record["status"] = "review"
                            record["confidence"] = candidates.map { $0.confidence }.max() ?? 0
                        }
                    }
                    regions.append(record)
                }
            }
            // Existing observations retain their reading order; conflicting
            // retries remain visible evidence rather than replacing words.
            let unresolved = regions.filter { ($0["status"] as? String) != "recovered" }.count
            if unresolved > 0 { findings.append("\(unresolved) suspect text region(s) require image comparison; automatic retries could not safely resolve them.") }
            if recovered > 0 { findings.append("Recovered text in \(recovered) previously uncovered region(s) using higher-resolution recognition; review the recovered spans.") }
            if !nativeLines.isEmpty { findings.append("Sparse embedded text triggered mixed-page coverage checks. Embedded text is preserved alongside OCR-only regions.") }
            if detected.isEmpty { findings.append("The independent text-region detector found no regions; coverage is unknown.") }
            let recognized = lines.map { $0.text }.joined(separator: "\n")
            pageEvidence.append(["page": index + 1, "method": nativeLines.isEmpty ? "ocr" : "mixed", "nativeText": embedded, "text": recognized.isEmpty ? embedded : recognized, "blocks": lines.map { $0.evidence }, "initialBlocks": initial.map { $0.evidence }, "coordinateSystem": "normalized-bottom-left", "findings": findings, "regions": regions, "coverage": ["detectedRegions": detected.count, "unmatchedRegions": missing.count, "retriedRegions": retried, "recoveredRegions": recovered, "unresolvedRegions": unresolved], "durationMs": Int(Date().timeIntervalSince(started) * 1000)])
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
    return value.replacingOccurrences(of: "^\\s*\\d+(?:\\.\\d+)*[.)]?\\s+", with: "", options: .regularExpression).split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
}
var unresolvedOutlines: [String] = []
func collectOutline(_ outline: PDFOutline, level: Int) {
    guard level <= 256 else { return }
    if let label = outline.label?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty {
        let target = normalizedHeading(label)
        var matches: [(Int, Int, String)] = []
        for (pageIndex, content) in pages.enumerated() {
            for (lineIndex, line) in content.components(separatedBy: "\n").enumerated() where normalizedHeading(line) == target {
                matches.append((pageIndex, lineIndex, line))
            }
        }
        let destination = outline.destination?.page.map { document.index(for: $0) }
        let local = matches.filter { $0.0 == destination }
        if let match = local.count == 1 ? local.first : (matches.count == 1 ? matches.first : nil) {
            structuralNodes.append(["text": match.2, "startLine": pageStartLines[match.0] + match.1, "level": min(6, max(1, level))])
        } else { unresolvedOutlines.append(label) }
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
let attributes: [AnyHashable: Any] = document.documentAttributes ?? [:]
var metadata: [String: String] = [:]
for (key, value) in attributes { metadata[String(describing: key)] = String(describing: value).prefix(2000).description }
let annotationCounts = (0..<document.pageCount).map { document.page(at: $0)?.annotations.count ?? 0 }
let output = try JSONSerialization.data(withJSONObject: ["text": text, "pages": document.pageCount, "ocrPages": ocrPages, "pageStartLines": pageStartLines, "structuralNodes": structuralNodes, "metadata": metadata, "annotationCounts": annotationCounts, "pageEvidence": pageEvidence, "unresolvedOutlines": unresolvedOutlines])
FileHandle.standardOutput.write(output)
