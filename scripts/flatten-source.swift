import Foundation
import PDFKit
import AppKit
import CoreGraphics

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8)); exit(1)
}
guard CommandLine.arguments.count == 3 else { fail("PDF flattening requires an input and output file.") }
let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard let document = PDFDocument(url: input) else { fail("The PDF is damaged or unreadable.") }
guard !document.isLocked else { fail("Unlock this password-protected PDF before attaching it.") }
guard document.pageCount > 0, document.pageCount <= 1000 else { fail("PDFs must contain between 1 and 1,000 pages.") }
guard let context = CGContext(output as CFURL, mediaBox: nil, nil) else { fail("Unable to create a flattened PDF.") }
for index in 0..<document.pageCount {
    autoreleasepool {
        guard let page = document.page(at: index) else { fail("A PDF page could not be read.") }
        let bounds = page.bounds(for: .mediaBox)
        guard bounds.width.isFinite, bounds.height.isFinite,
              bounds.width > 0, bounds.height > 0,
              bounds.width <= 14400, bounds.height <= 14400 else { fail("A PDF page has invalid or oversized dimensions.") }
        // Rebuild from rendered pixels only. Never copy PDF objects, annotations,
        // actions, attachments, metadata, or scripts into the admitted document.
        let rotated = abs(page.rotation % 180) == 90
        let width = rotated ? bounds.height : bounds.width
        let height = rotated ? bounds.width : bounds.height
        let scale = min(200.0 / 72.0, 3000.0 / max(width, height))
        let image = page.thumbnail(of: NSSize(width: width * scale, height: height * scale), for: .mediaBox)
        var imageRect = CGRect(origin: .zero, size: image.size)
        guard let bitmap = image.cgImage(forProposedRect: &imageRect, context: nil, hints: nil) else { fail("A PDF page could not be rendered for flattening.") }
        let box = CGRect(x: 0, y: 0, width: width, height: height)
        var mediaBox = box
        let mediaBoxData = NSData(bytes: &mediaBox, length: MemoryLayout<CGRect>.size)
        context.beginPDFPage([kCGPDFContextMediaBox as String: mediaBoxData] as CFDictionary)
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(box)
        context.draw(bitmap, in: box)
        context.endPDFPage()
    }
    if let size = try? output.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 50 * 1024 * 1024 {
        fail("The flattened PDF exceeds the 50 MB limit. Split it into smaller files and try again.")
    }
}
context.closePDF()
guard let flattened = PDFDocument(url: output), flattened.pageCount == document.pageCount,
      !flattened.isEncrypted else { fail("The flattened PDF could not be verified.") }
