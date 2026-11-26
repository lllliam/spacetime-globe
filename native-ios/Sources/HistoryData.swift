import Foundation

func eraYear(_ year: Int) -> String {
    year < 0 ? "前\(-year)" : String(year)
}

func yearRange(_ from: Int, _ to: Int?) -> String {
    guard let to else { return "\(eraYear(from)) 年至今" }
    return from == to ? "\(eraYear(from)) 年" : "\(eraYear(from))–\(eraYear(to)) 年"
}

struct Evidence: Decodable, Hashable {
    let sourceId: String
    let locator: String?
    let note: String?
}

struct HistorySource: Decodable, Identifiable {
    let id: String
    let title: String
    let url: String
    let note: String?

    var link: URL? {
        guard let url = URL(string: url), ["https", "http"].contains(url.scheme) else { return nil }
        return url
    }
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
}

struct ReadingLink: Decodable, Identifiable {
    let id: String
    let volume: String
    let chapter: String?
    let label: String?
    let note: String?
    let refs: [Evidence]
}

struct SceneRef: Decodable {
    let id: String
    let afterBlockId: String?
    let stageId: String?
}

struct Chapter: Decodable, Identifiable {
    let id: String
    let title: String
    let from: Int
    let to: Int?
    let date: String?
    let summary: String?
    let scope: String?
    let thesis: String?
    let thesisId: String?
    let recommend: Bool
    let recommendationFrom: Int?
    let recommendationTo: Int?
    let recommendationPriority: Int?
    let blocks: [TextBlock]
    let sources: [HistorySource]
    let links: [ReadingLink]
    let scenes: [SceneRef]

    var dateText: String { date ?? yearRange(from, to) }
}

struct Volume: Decodable, Identifiable {
    let id: String
    let title: String
    let from: Int
    let to: Int?
    let summary: String?
    let subtitle: String?
    let notice: String?
    let continents: [String]?
    let chapters: [Chapter]

    var dateText: String { subtitle ?? yearRange(from, to) }
    var isTopic: Bool { id.hasPrefix("topic:") }

    func recommendation(in year: Int) -> Chapter? {
        let matches = chapters.filter {
            $0.recommend && year >= ($0.recommendationFrom ?? $0.from)
                && year <= ($0.recommendationFrom != nil ? $0.recommendationTo ?? Int.max : $0.to ?? Int.max)
        }
        let priority = matches.map { $0.recommendationPriority ?? 0 }.max()
        let best = matches.filter { ($0.recommendationPriority ?? 0) == priority }
        return best.count == 1 ? best[0] : nil
    }
}

struct ReadingTarget: Decodable, Identifiable {
    let volume: String
    let chapter: String?
    var id: String { volume + "/" + (chapter ?? "") }
}

struct HistoryEvent: Decodable, Identifiable {
    let id: String
    let title: String
    let from: Int
    let to: Int
    let background: Bool
    let regions: [String]
    let sources: [String]
    let lon: Double?
    let lat: Double?
    let reading: [ReadingTarget]
    let scene: String?
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
}

struct SceneRoute: Decodable, Identifiable {
    let id: String
    let label: String
    let note: String?
    let precision: String
    let coordinates: [[Double]]
}

struct SceneFrame: Decodable, Identifiable {
    let id: String
    let year: Int
    let title: String
    let note: String?
    let dateLabel: String?
    let places: [ScenePlace]
    let routes: [SceneRoute]
    let evidence: [Evidence]?
}

struct HistoryScene: Decodable, Identifiable {
    let id: String
    let title: String
    let status: String
    let question: String?
    let note: String?
    let limit: String?
    let naturalOnly: Bool?
    let frames: [SceneFrame]
    let sources: [HistorySource]
}

struct Archive: Decodable {
    let volumes: [Volume]
    let events: [HistoryEvent]
    let scenes: [HistoryScene]

    func volume(_ id: String) -> Volume? { volumes.first { $0.id == id } }
    func scene(_ id: String) -> HistoryScene? { scenes.first { $0.id == id && $0.status == "available" } }
    func event(_ id: String) -> HistoryEvent? { events.first { $0.id == id } }
    func events(in year: Int) -> [HistoryEvent] {
        events.filter { $0.from <= year && year <= $0.to }.sorted {
            if $0.from != $1.from { return $0.from > $1.from }
            if $0.reading.isEmpty != $1.reading.isEmpty { return !$0.reading.isEmpty }
            return $0.id < $1.id
        }
    }
}

enum GlobeLayer: String, CaseIterable, Codable, Identifiable {
    case timeline, countries, terrain
    var id: String { rawValue }
    var label: String {
        switch self {
        case .timeline: return "随年份"
        case .countries: return "现代边界"
        case .terrain: return "自然地形"
        }
    }
}

struct MapRegion: Identifiable {
    let id: String
    let name: String
    let dates: String
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
        let name: String
        let from: Int?
        let to: Int?
        let dateLabel: String?
        let scope: String?
    }

    struct Binding: Decodable, Identifiable {
        let volume: String
        let from: Int
        let to: Int?
        let relation: String
        let reason: String?
        let chapter: String?
        var id: String { "\(volume)/\(chapter ?? "")/\(from)" }
    }

    struct Coverage: Decodable {
        let from: Int
        let to: Int
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
    let coverage: Coverage
    let mapSources: [String: MapSource]

    func bindings(_ id: String, in year: Int) -> [Binding] {
        (books[id] ?? []).filter { $0.from <= year && year <= ($0.to ?? Int.max) }
    }
}

struct OfflineHistory {
    let archive: Archive
    let index: AtlasIndex
    let polygons: Data
    let resources: URL

    init(directory: URL) throws {
        resources = directory
        let decoder = JSONDecoder()
        archive = try decoder.decode(Archive.self, from: Data(contentsOf: directory.appendingPathComponent("Library.json")))
        index = try decoder.decode(AtlasIndex.self, from: Data(contentsOf: directory.appendingPathComponent("Atlas.json")))
        polygons = try Data(contentsOf: directory.appendingPathComponent("polity.bin"), options: .mappedIfSafe)
    }
}
