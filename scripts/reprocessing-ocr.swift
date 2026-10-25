import Foundation
import ImageIO
import Vision

func fail(_ message: String) -> Never { FileHandle.standardError.write(Data(message.utf8)); exit(1) }
let data = FileHandle.standardInput.readDataToEndOfFile()
guard data.count > 0, data.count <= 12 * 1024 * 1024,
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      image.width <= 5000, image.height <= 5000 else { fail("Invalid bounded page image") }
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.minimumTextHeight = 0.003
request.usesCPUOnly = true
if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }
do {
 try VNImageRequestHandler(cgImage: image).perform([request])
 let observations = request.results ?? []
 guard observations.count <= 2000 else { fail("OCR line limit exceeded") }
 let lines: [[String: Any]] = observations.compactMap { observation in
  guard let best = observation.topCandidates(1).first, best.string.utf16.count <= 4000 else { return nil }
  let box = observation.boundingBox
  return ["text": best.string, "confidence": Double(best.confidence), "bounds": [Double(box.minX), Double(box.minY), Double(box.width), Double(box.height)], "alternatives": observation.topCandidates(3).dropFirst().map { $0.string }]
 }
 let result: [String: Any] = ["engine": "AppleVision", "version": "revision-\(request.revision)", "configuration": "accurate;languageCorrection=false;cpuOnly=true;normalized-bottom-left", "lines": lines]
 FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
} catch {
 let failure = error as NSError
 fail("Local raster OCR failed (\(failure.domain) \(failure.code)): \(failure.localizedDescription)")
}
