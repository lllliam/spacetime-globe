import Foundation

@main
enum Smoke {
    static func main() throws {
        let dir = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        if CommandLine.arguments.count == 3 {
            let app = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
            let bundle = Bundle(url: app)
            precondition(bundle?.bundleIdentifier == "io.github.lllliam.spacetimeglobe.native")
            guard let library = bundle?.url(forResource: "Library", withExtension: "json", subdirectory: "OfflineData") else {
                throw CocoaError(.fileNoSuchFile)
            }
            let packaged = try Data(contentsOf: library)
            let original = try Data(contentsOf: dir.appendingPathComponent("Library.json"))
            precondition(packaged == original)
            print("Foundation recognizes the native app identifier and bundled offline library.")
            return
        }
        let history = try OfflineHistory(directory: dir)
        let archive = history.archive
        let atlas = try GlobeAtlas(index: history.index, polygons: history.polygons)
        precondition(archive.volumes.count >= 85)
        precondition(archive.volumes.flatMap(\.chapters).count >= 360)
        precondition(archive.events.count >= 1475)
        precondition(archive.scenes.filter { $0.status == "available" }.count >= 44)
        let ming = try atlas.paint(layer: .timeline, year: 1500)
        precondition(ming.pick(at: CGPoint(x: (116.4 + 180) / 0.36, y: (90 - 39.9) / 0.36))?.id == "polity:Ming Dynasty")
        precondition(atlas.index.bindings("polity:Ming Dynasty", in: 1500).contains { $0.volume == "ming" })
        precondition(archive.event("i-tr-constantinople-1453")?.reading.contains { $0.volume == "roman" } == true)
        precondition(archive.volume("ming")?.chapters.contains { !$0.scenes.isEmpty } == true)
        let ancient = try atlas.shapes(layer: .timeline, year: -221)
        precondition(!ancient.isEmpty && ancient.allSatisfy { $0.region.historical })
        let noCoverage = try atlas.shapes(layer: .timeline, year: -3500)
        precondition(noCoverage.isEmpty)
        let modern = try atlas.paint(layer: .timeline, year: 2025)
        precondition(modern.pick(at: CGPoint(x: (116.4 + 180) / 0.36, y: (90 - 39.9) / 0.36))?.id == "country:CN")
        let sea = try atlas.paint(layer: .terrain, year: 1500)
        precondition(sea.shapes.isEmpty && sea.image.width == 3072)
        print("Native offline decoding, historical and modern map picking, and reading links passed.")
    }
}
