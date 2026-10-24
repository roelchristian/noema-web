import Foundation
import PDFKit
import AppKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8)); exit(1)
}
guard (CommandLine.arguments.count == 3 || CommandLine.arguments.count == 4),
      let number = Int(CommandLine.arguments[2]),
      let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])),
      !document.isLocked, number > 0, number <= document.pageCount,
      let page = document.page(at: number - 1) else { fail("This source page is unavailable.") }
let bounds = page.bounds(for: .mediaBox)
guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0,
      bounds.width <= 14400, bounds.height <= 14400 else { fail("Invalid page dimensions.") }
if CommandLine.arguments.count == 4 && CommandLine.arguments[3] == "--layout" {
    // Rotation transformations are deliberately unsupported for automatic alignment.
    let blocks: [[String: Any]] = page.rotation % 360 == 0 ? (page.selection(for: bounds)?.selectionsByLine() ?? []).compactMap { selection in
        guard let text = selection.string, !text.isEmpty, text.utf16.count <= 4000 else { return nil }
        let box = selection.bounds(for: page).intersection(bounds)
        guard !box.isNull, box.width > 0, box.height > 0 else { return nil }
        return ["text": text, "bounds": [Double((box.minX - bounds.minX) / bounds.width), Double((box.minY - bounds.minY) / bounds.height), Double(box.width / bounds.width), Double(box.height / bounds.height)]]
    } : []
    guard blocks.count <= 2000, let bytes = try? JSONSerialization.data(withJSONObject: blocks, options: [.sortedKeys]) else { fail("Native layout evidence exceeds limits") }
    FileHandle.standardOutput.write(bytes); exit(0)
}
let rotated = abs(page.rotation % 180) == 90
let width = rotated ? bounds.height : bounds.width
let height = rotated ? bounds.width : bounds.height
let scale = min(2.5, 2400 / max(width, height))
let image = page.thumbnail(of: NSSize(width: width * scale, height: height * scale), for: .mediaBox)
var rect = CGRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil),
      let bytes = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]) else { fail("Could not render this page.") }
FileHandle.standardOutput.write(bytes)
