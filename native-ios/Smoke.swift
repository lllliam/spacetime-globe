import Foundation
import CoreGraphics

@main
enum Smoke {
    @MainActor static func main() throws {
        let directory = URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
        if CommandLine.arguments.count == 3 {
            let app = URL(fileURLWithPath:CommandLine.arguments[2],isDirectory:true)
            let bundle = Bundle(url:app)
            precondition(bundle?.bundleIdentifier == "io.github.lllliam.spacetimeglobe.native")
            guard let library = bundle?.url(forResource:"Library",withExtension:"json",subdirectory:"OfflineData") else {
                throw CocoaError(.fileNoSuchFile)
            }
            let packaged = try Data(contentsOf:library)
            let original = try Data(contentsOf:directory.appendingPathComponent("Library.json"))
            precondition(packaged == original)
            print("App identity and bundled content discovery succeeded.")
            return
        }
        let history = try OfflineHistory(directory:directory)
        let archive = history.archive
        let atlas = try GlobeAtlas(index:history.index,polygons:history.polygons)
        precondition(history.manifest.schemaVersion == 2)
        precondition(archive.volumes.count >= 85)
        precondition(archive.events.count >= 1475)
        precondition(Set(archive.events.flatMap(\.memberIds)).count == archive.events.flatMap(\.memberIds).count)
        precondition(archive.scenes.filter { $0.status == "available" }.count >= 44)
        for volume in archive.volumes {
            for entry in volume.chapters {
                let chapter = try history.chapters.read(entry)
                precondition(!chapter.blocks.isEmpty)
                precondition(Set(chapter.blocks.map(\.id)).count == chapter.blocks.count)
                for link in chapter.links {
                    precondition(archive.volume(link.volume) != nil)
                    if let target = link.chapter { precondition(archive.volume(link.volume)?.chapter(target) != nil) }
                }
            }
        }
        precondition(Chronology.offset(-1,1) == 1)
        precondition(Chronology.offset(1,-1) == -1)
        precondition(Chronology.parse("公元前221年") == -221)
        precondition(Chronology.parse("0") == nil)
        precondition(Chronology.offset(Chronology.latest,100) == Chronology.latest)
        let historical = try atlas.paint(layer:.timeline,year:1500)
        let beijing = CGPoint(x:(116.4 + 180)/0.36,y:(90 - 39.9)/0.36)
        precondition(historical.pick(at:beijing)?.id == "polity:Ming Dynasty")
        precondition(atlas.index.bindings("polity:Ming Dynasty",in:1500).contains { $0.volume == "ming" })
        precondition(archive.event("i-tr-constantinople-1453")?.reading.contains { $0.volume == "roman" } == true)
        let ancient = try atlas.shapes(layer:.timeline,year:-221)
        precondition(!ancient.isEmpty && ancient.allSatisfy { $0.region.historical })
        let beyond = try atlas.shapes(layer:.timeline,year:Chronology.latest)
        precondition(beyond.isEmpty)
        let modern = try atlas.paint(layer:.countries,year:Chronology.latest)
        precondition(modern.pick(at:beijing)?.id == "country:CN")
        let siteYears = Set(archive.scenes.flatMap { $0.frames.map(\.year) })
        let sites = siteYears.flatMap { archive.sites(in:$0) }
        precondition(!sites.isEmpty && sites.allSatisfy { $0.place.precision == "site" && archive.scene($0.scene) != nil })
        let search = HistorySearch(archive:archive,index:history.index)
        precondition(search.find("明朝").contains { $0.title == "明朝" })
        let view = CGSize(width:390,height:844)
        let frame = CGRect(x:10,y:105,width:370,height:480)
        let camera = GlobeCamera.fitting([[179,44],[-179,46]],in:view,visible:frame)
        precondition(camera.isValid && camera.zoom > 3)
        precondition(camera.project(longitude:179,latitude:44,size:view).map(frame.contains) == true)
        precondition(!historical.borders.isEmpty && historical.regionIDs["polity:Ming Dynasty"] != nil)
        var pinched = GlobeCamera()
        let finger = CGPoint(x:215,y:385)
        let next = CGPoint(x:233,y:401)
        let anchor = pinched.unproject(finger,size:view)!
        pinched.magnify(0.90,from:finger,to:next,size:view)
        let screen = pinched.project(anchor,size:view)!
        precondition(hypot(screen.x-next.x,screen.y-next.y) < 0.05)
        let decoder = JSONDecoder()
        let legacyClosed = try decoder.decode(DrawerPosition.self,from:Data("0".utf8))
        let legacyExpanded = try decoder.decode(DrawerPosition.self,from:Data("2".utf8))
        precondition(legacyClosed == .compact && legacyExpanded == .full)
        try migration(history)
        print("Offline chapters, source identities, event deduplication, map picking, search, chronology, framing and legacy persistence passed.")
    }

    @MainActor private static func migration(_ history: OfflineHistory) throws {
        let suite = "spacetime.smoke." + UUID().uuidString
        guard let defaults = UserDefaults(suiteName:suite),
              let book = history.archive.volume("ming"), let chapter = book.chapters.first else { fatalError("Missing fixture") }
        defer { defaults.removePersistentDomain(forName:suite) }
        let body = try history.chapters.read(chapter)
        defaults.set(1453,forKey:"exploreYear")
        defaults.set(false,forKey:"selectionHaptics")
        defaults.set(book.id,forKey:"lastReadingVolume")
        defaults.set(chapter.id,forKey:"lastReadingChapter")
        defaults.set(body.blocks[0].id,forKey:"readingAnchor:\(book.id)/\(chapter.id)")
        let session = SessionStore(archive:history.archive,index:history.index,defaults:defaults)
        precondition(session.explore.year == 1453 && !session.preferences.haptics)
        precondition(session.bookmark(for:book)?.block == body.blocks[0].id)
        session.open(ReadingNode(volume:book.id,chapter:chapter.id,entryYear:1500))
        session.record(ReadingPosition(volume:book.id,chapter:chapter.id,block:body.blocks[0].id,fraction:0.37))
        if let scene = history.archive.scenes.first(where:{ $0.status == "available" }) {
            session.startObservation(.scene(scene.id))
            precondition(session.observe != nil && session.reading != nil)
        }
        session.save()
        let restored = SessionStore(archive:history.archive,index:history.index,defaults:defaults)
        precondition(restored.observe == nil && restored.reading?.nodes.last?.entryYear == 1500)
        precondition(restored.position(volume:book,chapter:chapter)?.fraction == 0.37)
    }
}
