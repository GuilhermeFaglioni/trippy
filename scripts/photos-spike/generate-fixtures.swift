import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct PhotoFixture {
  let filename: String
  let type: UTType
  let dateTimeOriginal: String?
  let offsetTimeOriginal: String?
  let latitude: Double?
  let longitude: Double?
}

let fixtures = [
  PhotoFixture(
    filename: "heic-beijing-offset-gps.heic",
    type: .heic,
    dateTimeOriginal: "2026:10:20 08:12:03",
    offsetTimeOriginal: "+08:00",
    latitude: 39.9042,
    longitude: 116.4074
  ),
  PhotoFixture(
    filename: "jpeg-paraty-offset-gps.jpg",
    type: .jpeg,
    dateTimeOriginal: "2026:10:19 20:45:10",
    offsetTimeOriginal: "-03:00",
    latitude: -23.2237,
    longitude: -44.7192
  ),
  PhotoFixture(
    filename: "jpeg-tokyo-no-offset.jpg",
    type: .jpeg,
    dateTimeOriginal: "2026:10:18 14:20:00",
    offsetTimeOriginal: nil,
    latitude: 35.6762,
    longitude: 139.6503
  ),
  PhotoFixture(
    filename: "jpeg-no-exif.jpg",
    type: .jpeg,
    dateTimeOriginal: nil,
    offsetTimeOriginal: nil,
    latitude: nil,
    longitude: nil
  ),
  PhotoFixture(
    filename: "heic-no-exif.heic",
    type: .heic,
    dateTimeOriginal: nil,
    offsetTimeOriginal: nil,
    latitude: nil,
    longitude: nil
  ),
]

let scriptDirectory = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
let outputDirectory = scriptDirectory.appendingPathComponent("fixtures", isDirectory: true)
try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

func makeTestImage(width: Int, height: Int) throws -> CGImage {
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  guard let context = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: width * 4,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
  ) else {
    throw NSError(domain: "TrippyPhotoFixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Não foi possível criar o bitmap."])
  }

  let bands: [CGColor] = [
    CGColor(red: 0.22, green: 0.35, blue: 0.31, alpha: 1),
    CGColor(red: 0.81, green: 0.52, blue: 0.35, alpha: 1),
    CGColor(red: 0.85, green: 0.77, blue: 0.58, alpha: 1),
    CGColor(red: 0.26, green: 0.44, blue: 0.48, alpha: 1),
  ]

  let bandHeight = CGFloat(height) / CGFloat(bands.count)
  for (index, color) in bands.enumerated() {
    context.setFillColor(color)
    context.fill(CGRect(x: 0, y: CGFloat(index) * bandHeight, width: CGFloat(width), height: bandHeight))
  }

  context.setStrokeColor(CGColor(red: 0.98, green: 0.91, blue: 0.76, alpha: 1))
  context.setLineWidth(CGFloat(max(width, height)) / 180)
  context.move(to: CGPoint(x: CGFloat(width) * 0.08, y: CGFloat(height) * 0.18))
  context.addLine(to: CGPoint(x: CGFloat(width) * 0.28, y: CGFloat(height) * 0.67))
  context.addLine(to: CGPoint(x: CGFloat(width) * 0.55, y: CGFloat(height) * 0.35))
  context.addLine(to: CGPoint(x: CGFloat(width) * 0.90, y: CGFloat(height) * 0.76))
  context.strokePath()

  guard let image = context.makeImage() else {
    throw NSError(domain: "TrippyPhotoFixture", code: 2, userInfo: [NSLocalizedDescriptionKey: "Não foi possível finalizar o bitmap."])
  }
  return image
}

func exifProperties(for fixture: PhotoFixture) -> [CFString: Any] {
  var properties: [CFString: Any] = [:]
  if let dateTimeOriginal = fixture.dateTimeOriginal {
    var exif: [CFString: Any] = [kCGImagePropertyExifDateTimeOriginal: dateTimeOriginal]
    if let offsetTimeOriginal = fixture.offsetTimeOriginal {
      exif["OffsetTimeOriginal" as CFString] = offsetTimeOriginal
    }
    properties[kCGImagePropertyExifDictionary] = exif
  }

  if let latitude = fixture.latitude, let longitude = fixture.longitude {
    properties[kCGImagePropertyGPSDictionary] = [
      kCGImagePropertyGPSLatitude: abs(latitude),
      kCGImagePropertyGPSLatitudeRef: latitude < 0 ? "S" : "N",
      kCGImagePropertyGPSLongitude: abs(longitude),
      kCGImagePropertyGPSLongitudeRef: longitude < 0 ? "W" : "E",
    ] as [CFString: Any]
  }
  return properties
}

func readMetadata(_ url: URL) throws -> [CFString: Any] {
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else {
    throw NSError(domain: "TrippyPhotoFixture", code: 3, userInfo: [NSLocalizedDescriptionKey: "Não foi possível ler (url.lastPathComponent)."])
  }
  return properties
}

let image = try makeTestImage(width: 2560, height: 1700)
for fixture in fixtures {
  let outputURL = outputDirectory.appendingPathComponent(fixture.filename)
  try? FileManager.default.removeItem(at: outputURL)

  guard let destination = CGImageDestinationCreateWithURL(
    outputURL as CFURL,
    fixture.type.identifier as CFString,
    1,
    nil
  ) else {
    throw NSError(domain: "TrippyPhotoFixture", code: 4, userInfo: [NSLocalizedDescriptionKey: "Não há encoder para (fixture.type.identifier)."])
  }

  let properties = exifProperties(for: fixture) as CFDictionary
  CGImageDestinationAddImage(destination, image, properties)
  guard CGImageDestinationFinalize(destination) else {
    throw NSError(domain: "TrippyPhotoFixture", code: 5, userInfo: [NSLocalizedDescriptionKey: "Não foi possível gravar (fixture.filename)."])
  }

  let data = try Data(contentsOf: outputURL)
  let metadata = try readMetadata(outputURL)
  let exif = metadata[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
  let gps = metadata[kCGImagePropertyGPSDictionary] as? [CFString: Any] ?? [:]
  let date = exif[kCGImagePropertyExifDateTimeOriginal] ?? "sem EXIF"
  let offset = exif["OffsetTimeOriginal" as CFString] ?? "sem fuso"
  let gpsStatus = gps.isEmpty ? "sem GPS" : "GPS presente"
  let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  print("\(fixture.filename) | \(data.count) bytes | \(date) | \(offset) | \(gpsStatus) | sha256 \(hash)")
}
