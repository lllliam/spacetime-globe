import CoreGraphics
import Foundation

struct RegionShape {
    let region: MapRegion
    let path: CGPath
    let bounds: CGRect
    let center: CGPoint

    var area: CGFloat { bounds.width * bounds.height }

    init?(region: MapRegion, rings: [[CGPoint]]) {
        let path = CGMutablePath()
        var largest = CGRect.zero
        for points in rings where points.count >= 3 {
            let ring = CGMutablePath()
            ring.addLines(between: points)
            ring.closeSubpath()
            path.addPath(ring)
            let frame = ring.boundingBox
            if frame.width * frame.height > largest.width * largest.height { largest = frame }
        }
        guard !path.isEmpty else { return nil }
        self.region = region
        self.path = path
        bounds = path.boundingBox
        center = CGPoint(x: largest.midX, y: largest.midY)
    }
}

struct PaintedAtlas {
    let shapes: [RegionShape]
    let image: CGImage

    func pick(at point: CGPoint) -> MapRegion? {
        shapes.reversed().first {
            $0.bounds.contains(point) && $0.path.contains(point, using: .evenOdd)
        }?.region
    }
}

struct GlobeAtlas {
    enum FormatError: Error { case invalidAtlas }
    private struct Slice {
        let entity: Int
        let from: Int
        let to: Int
        let path: Int
    }

    let index: AtlasIndex
    private let data: Data
    private let entities: [MapRegion?]
    private let slices: [Slice]
    private let offsets: [Int]
    private let countries: [RegionShape]

    init(index: AtlasIndex, polygons: Data) throws {
        self.index = index
        data = polygons
        var reader = BinaryCursor(data: polygons, offset: 0, end: polygons.count)
        guard try reader.string(length: 4) == "SGP1" else { throw FormatError.invalidAtlas }
        let entityCount = try reader.uint32(), sliceCount = try reader.uint32(), pathCount = try reader.uint32()
        let entityStart = try reader.uint32(), sliceStart = try reader.uint32(), pathIndex = try reader.uint32()
        guard entityStart >= 28, sliceStart >= entityStart, pathIndex >= sliceStart, pathIndex <= polygons.count,
              entityCount <= (sliceStart - entityStart) / 6, sliceCount <= (pathIndex - sliceStart) / 8,
              pathCount < (polygons.count - pathIndex) / 4 else { throw FormatError.invalidAtlas }
        let hidden = Set(index.relations)
        reader = BinaryCursor(data: polygons, offset: entityStart, end: sliceStart)
        var list: [MapRegion?] = []
        for _ in 0..<entityCount {
            let length = try reader.uint16()
            let name = try reader.string(length: length)
            let start = try reader.int16(), end = try reader.int16()
            if hidden.contains(name) {
                list.append(nil)
                continue
            }
            let key = "polity:" + name, subject = index.subjects[key]
            let dates = subject?.dateLabel ?? subject?.from.map { yearRange($0, subject?.to) }
                ?? "底图记录 " + yearRange(start,end)
            list.append(MapRegion(id:key, name:subject?.name ?? index.names[name] ?? name,
                                  dates:dates, note:subject?.scope, historical:true))
        }
        entities = list
        reader = BinaryCursor(data: polygons, offset: sliceStart, end: pathIndex)
        slices = try (0..<sliceCount).map { _ in
            let entity = try reader.uint16(), from = try reader.int16(), to = try reader.int16(), path = try reader.uint16()
            guard entity < entityCount, path < pathCount else { throw FormatError.invalidAtlas }
            return Slice(entity:entity, from:from, to:to, path:path)
        }
        reader = BinaryCursor(data: polygons, offset: pathIndex, end: polygons.count)
        let positions = try (0...pathCount).map { _ in try reader.uint32() }
        guard (positions.first ?? 0) >= reader.offset, positions.last == polygons.count,
              zip(positions, positions.dropFirst()).allSatisfy({ $0.0 < $0.1 }) else {
            throw FormatError.invalidAtlas
        }
        offsets = positions
        countries = index.countries.compactMap { country in
            let key = "country:" + country.id
            let region = MapRegion(id:key, name:country.name, dates:"现代参考边界", note:index.subjects[key]?.scope, historical:false)
            let rings = country.rings.map { ring in
                ring.compactMap { $0.count == 2 ? CGPoint(x:$0[0], y:$0[1]) : nil }
            }
            return RegionShape(region:region, rings:rings)
        }.sorted { $0.area > $1.area }
    }

    func shapes(layer: GlobeLayer, year: Int) throws -> [RegionShape] {
        switch layer {
        case .terrain: return []
        case .countries: return countries
        case .timeline:
            if year > index.coverage.to { return countries }
            if year < index.coverage.from { return [] }
            return try slices.compactMap { slice -> RegionShape? in
                guard slice.from <= year, year <= slice.to, let region = entities[slice.entity] else { return nil }
                return try RegionShape(region:region, rings:path(slice.path))
            }.sorted { $0.area > $1.area }
        }
    }

    private func path(_ number: Int) throws -> [[CGPoint]] {
        var reader = BinaryCursor(data:data, offset:offsets[number], end:offsets[number+1])
        let count = try reader.uint16()
        return try (0..<count).map { _ in
            let points = try reader.uint16()
            guard points > 0 else { throw FormatError.invalidAtlas }
            var x = try reader.uint16(), y = try reader.uint16()
            var ring = [CGPoint(x:Double(x)/4, y:Double(y)/4)]
            ring.reserveCapacity(points)
            for _ in 1..<points {
                x += try reader.delta()
                y += try reader.delta()
                ring.append(CGPoint(x:Double(x)/4, y:Double(y)/4))
            }
            return ring
        }
    }

    func paint(layer: GlobeLayer, year: Int, selected: String? = nil) throws -> PaintedAtlas {
        let shapes = try shapes(layer:layer, year:year)
        let width = 3072, height = 1536
        guard let image = CGContext(data:nil, width:width, height:height, bitsPerComponent:8,
                                    bytesPerRow:width*4, space:CGColorSpaceCreateDeviceRGB(),
                                    bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw FormatError.invalidAtlas
        }
        image.translateBy(x:0, y:CGFloat(height))
        image.scaleBy(x:CGFloat(width)/1000, y:-CGFloat(height)/500)
        image.setLineJoin(.round)
        for shape in shapes {
            image.addPath(shape.path)
            let chosen = shape.region.id == selected
            image.setFillColor(red:0.56, green:0.47, blue:0.26,
                               alpha:chosen ? 0.27 : shape.region.historical ? 0.12 : 0.02)
            image.setStrokeColor(red:0.88,green:0.77,blue:0.56,alpha:chosen ? 1 : 0.58)
            image.setLineWidth(chosen ? 0.85 : 0.37)
            image.drawPath(using:.eoFillStroke)
        }
        guard let result = image.makeImage() else { throw FormatError.invalidAtlas }
        return PaintedAtlas(shapes:shapes, image:result)
    }
}

private struct BinaryCursor {
    let data: Data
    var offset: Int
    let end: Int

    mutating func byte() throws -> Int {
        guard offset < end else { throw GlobeAtlas.FormatError.invalidAtlas }
        defer { offset += 1 }
        return Int(data[offset])
    }

    mutating func uint16() throws -> Int {
        let a = try byte(), b = try byte()
        return a | (b << 8)
    }

    mutating func int16() throws -> Int {
        Int(Int16(bitPattern:UInt16(try uint16())))
    }

    mutating func uint32() throws -> Int {
        let a = try uint16(), b = try uint16()
        return a | (b << 16)
    }

    mutating func string(length: Int) throws -> String {
        guard offset + length <= end else { throw GlobeAtlas.FormatError.invalidAtlas }
        defer { offset += length }
        return String(decoding:data[offset..<(offset + length)], as:UTF8.self)
    }

    mutating func delta() throws -> Int {
        var result = 0
        for shift in stride(from:0, to:35, by:7) {
            let value = try byte()
            result |= (value & 127) << shift
            if value < 128 { return (result >> 1) ^ -(result & 1) }
        }
        throw GlobeAtlas.FormatError.invalidAtlas
    }
}
