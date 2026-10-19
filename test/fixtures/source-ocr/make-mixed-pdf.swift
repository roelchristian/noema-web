import Foundation
import AppKit
import CoreText
let output = URL(fileURLWithPath: CommandLine.arguments[1])
let font = CTFontCreateWithName("Helvetica" as CFString, 18, nil)
func line(_ text: String, _ context: CGContext, _ x: CGFloat, _ y: CGFloat) {
    let attributes: [NSAttributedString.Key: Any] = [NSAttributedString.Key(kCTFontAttributeName as String): font]
    context.textPosition = CGPoint(x: x, y: y)
    CTLineDraw(CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes)), context)
}
let bitmap = CGContext(data: nil, width: 1200, height: 600, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
bitmap.setFillColor(CGColor(gray: 1, alpha: 1));bitmap.fill(CGRect(x: 0, y: 0, width: 1200, height: 600))
bitmap.scaleBy(x: 2, y: 2)
line("Scanned body remains visible below the native header.", bitmap, 30, 240)
line("Dante as well.", bitmap, 30, 200)
line("Regan Arts.", bitmap, 30, 160)
var box = CGRect(x: 0, y: 0, width: 612, height: 792)
let pdf = CGContext(output as CFURL, mediaBox: &box, nil)!
pdf.beginPDFPage(nil)
line("Embedded header with enough text to bypass the old threshold", pdf, 30, 730)
pdf.draw(bitmap.makeImage()!, in: CGRect(x: 0, y: 350, width: 600, height: 300))
pdf.endPDFPage();pdf.closePDF()
