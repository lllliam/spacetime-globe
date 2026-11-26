import Foundation

func eraYear(_ year: Int) -> String {
    year < 0 ? "前\(-year)" : String(year)
}

func yearRange(_ from: Int, _ to: Int?) -> String {
    guard let to else { return "\(eraYear(from)) 年至今" }
    return from == to ? "\(eraYear(from)) 年" : "\(eraYear(from))–\(eraYear(to)) 年"
}

enum Chronology {
    static let first = -3500
    static var latest: Int { Calendar(identifier: .gregorian).component(.year, from: .now) }
    static var range: ClosedRange<Int> { first...latest }

    static func index(_ year: Int) -> Int { year > 0 ? year - 1 : year }
    static func year(_ index: Int) -> Int { index >= 0 ? index + 1 : index }
    static func offset(_ year: Int, _ delta: Int) -> Int { self.year(index(year) + delta).clamped(to: range) }
    static func accepts(_ year: Int) -> Bool { year != 0 && range.contains(year) }

    static func parse(_ raw: String) -> Int? {
        let input = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "公元前", with: "-")
            .replacingOccurrences(of: "公元后", with: "")
            .replacingOccurrences(of: "公元", with: "")
            .replacingOccurrences(of: "前", with: "-")
            .replacingOccurrences(of: "−", with: "-")
            .trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: "年")))
        guard let value = Int(input), accepts(value) else { return nil }
        return value
    }
}

extension Comparable {
    func clamped(to bounds: ClosedRange<Self>) -> Self {
        min(max(self, bounds.lowerBound), bounds.upperBound)
    }
}

struct Evidence: Decodable, Hashable {
    let sourceId: String
    let locator: String?
    let note: String?
}

struct HistoryAudit: Decodable {
    let status: String
    let scope: String?
    let note: String?
    let checkedAt: String?

    var label: String {
        switch status {
        case "checked": return "已按所列范围核对"
        case "disputed": return "存在争议"
        case "insufficient": return "依据不足"
        case "issues": return "有待处理的问题"
        case "legacy": return "沿用资料，待逐条核对"
        default: return "待核对"
        }
    }
}

struct HistorySource: Decodable, Identifiable {
    let id: String
    let title: String
    let url: String
    let note: String?
    let audit: HistoryAudit?
    let checkedAt: String?

    var link: URL? { sourceURL(url) }
}

func sourceURL(_ text: String) -> URL? {
    guard let url = URL(string: text), ["https", "http"].contains(url.scheme), url.host != nil else { return nil }
    return url
}

struct Callout: Decodable {
    let id: String
    let label: String?
    let title: String?
    let text: String
    let refs: [Evidence]
}

struct TextBlock: Decodable, Identifiable {
    let id: String
    let heading: String?
    let text: String
    let refs: [Evidence]
    let callout: Callout?
    let audit: HistoryAudit?
}

enum RelationKind: String, CaseIterable {
    case contemporary, compare, documented, context, further, legacy

    init(value: String) { self = Self(rawValue: value) ?? .legacy }

    var title: String {
        switch self {
        case .contemporary: return "共时历史"
        case .compare: return "历史比较"
        case .documented: return "有据可查的联系"
        case .context: return "历史背景"
        case .further: return "延伸阅读"
        case .legacy: return "相关资料"
        }
    }
}

struct HistoricalRange: Decodable {
    let from: Int
    let to: Int?

    func contains(_ year: Int) -> Bool { year >= from && year <= (to ?? Int.max) }
}

struct ReadingLink: Decodable {
    let id: String?
    let volume: String
    let chapter: String?
    let label: String?
    let note: String?
    let relation: String
    let dimension: String?
    let time: HistoricalRange?
    let audit: HistoryAudit?
    let refs: [Evidence]

    var kind: RelationKind { RelationKind(value: relation) }
}

struct SceneRef: Decodable {
    struct PlaceLink: Decodable {
        let blockId: String
        let text: String
        let placeId: String
        let stageId: String?
    }
    let id: String
    let afterBlockId: String?
    let stageId: String?
    let placeLinks: [PlaceLink]?
}

struct Chapter: Decodable, Identifiable {
    struct Recommendation: Decodable {
        let priority: Int?
        let range: HistoricalRange?
    }
    let id: String
    let title: String
    let from: Int
    let to: Int?
    let date: String?
    let summary: String?
    let aliases: [String]
    let file: String
    let recommend: Bool
    let recommendation: Recommendation?

    var dateText: String { date ?? yearRange(from, to) }
}

struct ChapterBody: Decodable {
    let scope: String?
    let thesis: String?
    let spatialThesisId: String?
    let openingBlockId: String?
    let audit: HistoryAudit?
    let blocks: [TextBlock]
    let sources: [HistorySource]?
    let links: [ReadingLink]
    let scenes: [SceneRef]
}

struct Volume: Decodable, Identifiable {
    let id: String
    let title: String
    let from: Int
    let to: Int?
    let date: String?
    let summary: String?
    let scope: String?
    let notice: String?
    let aliases: [String]
    let regions: [String]
    let subjectIds: [String]?
    let sources: [HistorySource]?
    let links: [ReadingLink]
    let chapters: [Chapter]

    var dateText: String { date ?? yearRange(from,to) }
    var isTopic: Bool { id.hasPrefix("topic:") }

    func chapter(_ id: String?) -> Chapter? {
        guard let id else { return nil }
        return chapters.first { $0.id == id || $0.aliases.contains(id) }
    }

    func recommendations(in year: Int) -> [Chapter] {
        let matches = chapters.filter {
            $0.recommend && ($0.recommendation?.range ?? HistoricalRange(from: $0.from, to: $0.to)).contains(year)
        }
        let priority = matches.map { $0.recommendation?.priority ?? 0 }.max()
        return matches.filter { ($0.recommendation?.priority ?? 0) == priority }
    }
}

struct ReadingTarget: Codable, Hashable, Identifiable {
    let volume: String
    let chapter: String?

    var id: String { volume + "/" + (chapter ?? "") }
}

struct HistoryEvent: Decodable, Identifiable {
    struct Annotation: Decodable {
        let summary: String?
        let context: Bool?
        let blocks: [TextBlock]
        let sources: [HistorySource]
    }
    let id: String
    let groupId: String?
    let memberIds: [String]
    let aliases: [String]
    let title: String
    let date: String?
    let from: Int
    let to: Int
    let background: Bool
    let regions: [String]
    let sources: [String]
    let lon: Double?
    let lat: Double?
    let placement: String?
    let reading: [ReadingTarget]
    let scene: String?
    let annotation: Annotation?

    var dateText: String { date ?? yearRange(from,to) }
}

struct ScenePlace: Decodable, Identifiable {
    let id: String
    let name: String
    let lon: Double
    let lat: Double
    let role: String?
    let precision: String?
    let note: String?
    let evidence: [Evidence]?

    var precisionText: String {
        switch precision {
        case "site": return "有定位依据"
        case "region": return "区域代表位置"
        case "reference": return "现代参照"
        default: return "近似位置"
        }
    }
}

struct SceneRoute: Decodable, Identifiable {
    let id: String
    let label: String
    let note: String?
    let precision: String
    let coordinates: [[Double]]
    let evidence: [Evidence]?
    let directed: Bool?
    let directionEvidence: [Evidence]?
    let audit: HistoryAudit?

    var precisionText: String {
        switch precision {
        case "attested": return "有据路线"
        case "approximate": return "近似通道"
        default: return "示意联系"
        }
    }
}

struct SceneFrame: Decodable, Identifiable {
    let id: String
    let year: Int
    let title: String
    let note: String?
    let dateLabel: String?
    let places: [ScenePlace]
    let routes: [SceneRoute]
    let focusPolities: [String]
    let evidence: [Evidence]?
}

struct HistoryScene: Decodable, Identifiable {
    struct Unlocated: Decodable, Identifiable {
        let id: String
        let name: String
        let note: String?
        let role: String?
        let evidence: [Evidence]?
    }
    let id: String
    let title: String
    let year: Int
    let status: String
    let question: String?
    let note: String?
    let limit: String?
    let naturalOnly: Bool?
    let frames: [SceneFrame]
    let sources: [HistorySource]
    let evidence: [Evidence]?
    let unknownPlaces: [Unlocated]?
    let distanceBetween: [String]?
    let audit: HistoryAudit?
}

enum GlobeLayer: String, CaseIterable, Codable, Identifiable {
    case timeline, countries, terrain
    var id: String { rawValue }
    var label: String {
        switch self {
        case .timeline: return "历史疆域"
        case .countries: return "现代参考边界"
        case .terrain: return "自然地形"
        }
    }
}

struct MapRegion: Identifiable {
    let id: String
    let name: String
    let subjectId: String?
    let dates: String
    let coverage: String?
    let summary: String?
    let note: String?
    let historical: Bool
}

struct AtlasIndex: Decodable {
    struct Country: Decodable {
        let id: String
        let name: String
        let rings: [[[Double]]]
    }
    struct Subject: Decodable {
        let id: String
        let name: String
        let type: String
        let from: Int?
        let to: Int?
        let dateLabel: String?
        let scope: String?
        let summary: String?
        let aliases: [String]
        let audit: HistoryAudit?
    }
    struct Binding: Decodable, Identifiable {
        let volume: String
        let from: Int
        let to: Int?
        let relation: String
        let reason: String?
        let chapter: String?
        let subjectId: String?
        let audit: HistoryAudit?
        var id: String { "\(volume)/\(chapter ?? "")/\(from)/\(relation)" }
    }
    struct MapSource: Decodable {
        let name: String
        let source: URL
        let license: String?
        let limitations: String?
    }

    let countries: [Country]
    let subjects: [String: Subject]
    let books: [String: [Binding]]
    let names: [String: String]
    let relations: [String]
    let coverage: HistoricalRange
    let mapSources: [String: MapSource]

    static let empty = AtlasIndex(countries:[],subjects:[:],books:[:],names:[:],relations:[],
                                  coverage:HistoricalRange(from:1,to:0),mapSources:[:])

    func bindings(_ id: String, in year: Int) -> [Binding] {
        (books[id] ?? []).filter { $0.from <= year && year <= ($0.to ?? Int.max) }
    }

    func displayLayer(_ layer: GlobeLayer, year: Int) -> GlobeLayer {
        if layer == .timeline && !coverage.contains(year) { return .terrain }
        return layer
    }
}

struct ContentManifest: Decodable {
    let schemaVersion: Int
    let contentVersion: String
    let registryVersion: Int
}

struct ContentCatalog: Decodable {
    let volumes: [Volume]
    let events: [HistoryEvent]
}

struct MapSceneSite: Identifiable {
    let scene: String
    let stage: String
    let place: ScenePlace

    var id: String { scene + "/" + stage + "/" + place.id }
}

struct Archive {
    let volumes: [Volume]
    let events: [HistoryEvent]
    let scenes: [HistoryScene]
    private let volumeIndex: [String: Volume]
    private let eventIndex: [String: HistoryEvent]
    private let sceneIndex: [String: HistoryScene]
    private let pointYears: Set<Int>
    private let mapSites: [Int:[MapSceneSite]]

    init(catalog: ContentCatalog, scenes: [HistoryScene]) {
        volumes = catalog.volumes
        events = catalog.events.sorted {
            if $0.from != $1.from { return $0.from > $1.from }
            if $0.reading.isEmpty != $1.reading.isEmpty { return !$0.reading.isEmpty }
            return $0.id < $1.id
        }
        self.scenes = scenes
        volumeIndex = Dictionary(volumes.flatMap { volume in
            ([volume.id] + volume.aliases).map { ($0, volume) }
        }, uniquingKeysWith: { primary, _ in primary })
        eventIndex = Dictionary(events.flatMap { event in
            (event.memberIds + [event.id, event.groupId].compactMap { $0 }).map { ($0, event) }
        }, uniquingKeysWith: { primary, _ in primary })
        sceneIndex = Dictionary(scenes.filter { $0.status == "available" }.map { ($0.id, $0) },
                                uniquingKeysWith: { primary, _ in primary })
        var sites: [Int:[MapSceneSite]] = [:]
        for scene in scenes where scene.status == "available" {
            for frame in scene.frames {
                for place in frame.places where place.precision == "site" || place.precision == "approximate" {
                    let recorded = sites[frame.year,default:[]]
                    guard !recorded.contains(where:{
                        $0.place.name == place.name && $0.place.lat == place.lat && $0.place.lon == place.lon
                    }) else { continue }
                    sites[frame.year,default:[]].append(MapSceneSite(scene:scene.id,stage:frame.id,place:place))
                }
            }
        }
        mapSites = sites
        pointYears = Set(events.filter { !$0.background }.map(\.from))
    }

    func volume(_ id: String) -> Volume? { volumeIndex[id] }
    func scene(_ id: String) -> HistoryScene? { sceneIndex[id] }
    func sites(in year: Int) -> [MapSceneSite] { mapSites[year] ?? [] }
    func event(_ id: String) -> HistoryEvent? { eventIndex[id] }
    func events(in year: Int) -> [HistoryEvent] {
        events.drop(while: { $0.from > year }).filter { year <= $0.to }
    }
    func hasEventStarting(in year: Int) -> Bool { pointYears.contains(year) }
}

actor ChapterStore {
    private let directory: URL
    private var cache: [String: ChapterBody] = [:]
    private var recent: [String] = []

    init(directory: URL) { self.directory = directory }

    func load(_ chapter: Chapter) throws -> ChapterBody {
        try Task.checkCancellation()
        let key = chapter.file
        if let value = cache[key] {
            markRecent(key)
            return value
        }
        let body = try read(chapter)
        try Task.checkCancellation()
        cache[key] = body
        markRecent(key)
        if recent.count > 12 { cache.removeValue(forKey: recent.removeFirst()) }
        return body
    }

    nonisolated func read(_ chapter: Chapter) throws -> ChapterBody {
        guard chapter.file.range(of: #"^Chapters/[0-9a-f]{24}\.json$"#, options: .regularExpression) != nil else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return try JSONDecoder().decode(ChapterBody.self, from: Data(contentsOf: directory.appendingPathComponent(chapter.file)))
    }

    private func markRecent(_ key: String) {
        recent.removeAll { $0 == key }
        recent.append(key)
    }
}

struct OfflineHistory {
    let archive: Archive
    let index: AtlasIndex
    let manifest: ContentManifest
    let polygons: Data?
    let chapters: ChapterStore
    let resources: URL

    init(directory: URL) throws {
        resources = directory
        let decoder = JSONDecoder()
        func load<T: Decodable>(_ type: T.Type, _ file: String) throws -> T {
            try decoder.decode(type, from: Data(contentsOf: directory.appendingPathComponent(file)))
        }
        manifest = try load(ContentManifest.self, "Manifest.json")
        guard manifest.schemaVersion == 2 else { throw CocoaError(.fileReadUnknown) }
        let catalog = try load(ContentCatalog.self,"Library.json")
        archive = Archive(catalog:catalog,scenes:(try? load([HistoryScene].self,"Scenes.json")) ?? [])
        index = (try? load(AtlasIndex.self,"Atlas.json")) ?? .empty
        polygons = index.countries.isEmpty ? nil : (try? Data(contentsOf:directory.appendingPathComponent("polity.bin"),options:.mappedIfSafe))
        chapters = ChapterStore(directory: directory)
    }
}
