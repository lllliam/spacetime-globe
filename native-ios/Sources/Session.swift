import Foundation
import Combine

enum TimelineScale: Int, CaseIterable, Codable, Identifiable {
    case year = 1, decade = 10, century = 100
    var id: Int { rawValue }
    var label: String {
        switch self {
        case .year: return "逐年"
        case .decade: return "十年"
        case .century: return "百年"
        }
    }
}

enum DrawerPosition: Int, CaseIterable, Codable, Equatable {
    case compact = 1, full = 2

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        switch try container.decode(Int.self) {
        case 0, 1: self = .compact
        case 2: self = .full
        default: throw DecodingError.dataCorruptedError(in:container,debugDescription:"Unknown map drawer position")
        }
    }
}

enum ReaderPaper: String, CaseIterable, Codable, Identifiable {
    case paper, bright, night
    var id: String { rawValue }
    var label: String {
        switch self {
        case .paper: return "米纸"
        case .bright: return "明亮"
        case .night: return "夜间"
        }
    }
}

enum ReadingSize: Int, CaseIterable, Codable, Identifiable {
    case small = 17, standard = 19, large = 22, extra = 25
    var id: Int { rawValue }
    var label: String {
        switch self {
        case .small: return "较小"
        case .standard: return "标准"
        case .large: return "较大"
        case .extra: return "最大"
        }
    }
}

struct Preferences: Codable, Equatable {
    var showNames = true
    var haptics = true
    var paper: ReaderPaper = .paper
    var textSize: ReadingSize = .standard
}

struct ExploreSession: Codable {
    var year = 1500
    var layer = GlobeLayer.timeline
    var camera = GlobeCamera()
    var selected: String?
    var drawer = DrawerPosition.compact
    var scale = TimelineScale.year
}

struct ReadingNode: Codable, Hashable {
    let target: ReadingTarget
    let entryYear: Int?
    var focusBlock: String?

    init(volume: String, chapter: String? = nil, entryYear: Int? = nil, focusBlock: String? = nil) {
        self.target = ReadingTarget(volume: volume, chapter: chapter)
        self.entryYear = entryYear
        self.focusBlock = focusBlock
    }
}

struct ReadingPosition: Codable, Equatable {
    let volume: String
    let chapter: String
    let block: String?
    let fraction: Double
    let fallback: [String]

    init(volume: String, chapter: String, block: String? = nil, fraction: Double = 0, fallback: [String] = []) {
        self.volume = volume
        self.chapter = chapter
        self.block = block
        self.fraction = fraction
        self.fallback = fallback
    }

    func anchor(in blocks: [TextBlock]) -> (String?, Double) {
        let ids = Set(blocks.map(\.id))
        if let block, ids.contains(block) {
            return (block, fraction.isFinite ? fraction.clamped(to: 0...1) : 0)
        }
        return (fallback.first(where: ids.contains), 0)
    }
}

enum Companion: Codable, Equatable, Identifiable {
    case library
    case year(Int, event: String? = nil)
    case options
    case sources
    case mapChoices([String])

    var id: String {
        switch self {
        case .library: return "library"
        case .year: return "year"
        case .options: return "options"
        case .sources: return "sources"
        case .mapChoices: return "choices"
        }
    }

    var restorable: Bool {
        switch self {
        case .year, .library: return true
        default: return false
        }
    }
}

struct ReadingSession: Codable {
    var nodes: [ReadingNode]
    let source: Companion?
}

struct ObservationSession: Equatable {
    enum Subject: Equatable { case scene(String), event(String, Int) }
    enum Origin: Equatable { case reading, companion(Companion), exploration }
    let subject: Subject
    let origin: Origin
    var stage: String?
    var selectedPlace: String?
    var drawer = DrawerPosition.compact

    var returnTitle: String {
        switch origin {
        case .reading: return "返回正文"
        case .companion(.year): return "返回史事"
        case .companion(.library): return "返回书目"
        default: return "返回探索"
        }
    }
}

struct MapJump: Equatable {
    let id = UUID()
    let mapID: String
    let year: Int?
}

struct ShelfContext: Codable, Equatable {
    var query = ""
    var event: String?
    var row: String?
    var showTopics = false
    var region: String?
    var period: HistoricalPeriod?
}

@MainActor
final class SessionStore: ObservableObject {
    @Published var explore: ExploreSession
    @Published var preferences: Preferences
    @Published private(set) var reading: ReadingSession?
    @Published private(set) var observe: ObservationSession?
    @Published var panel: Companion?
    @Published var shelf: ShelfContext
    @Published private(set) var jump: MapJump?
    @Published private(set) var lastRead: ReadingTarget?

    private let defaults: UserDefaults
    private let archive: Archive
    private let index: AtlasIndex
    private var progress: [String: ReadingPosition]
    private var bookmarks: [String: ReadingPosition]
    private var pendingSave: Task<Void, Never>?
    private static let key = "native.session.v2"

    private struct Saved: Codable {
        var schema: Int = 2
        var explore: ExploreSession
        var preferences: Preferences
        var reading: ReadingSession?
        var panel: Companion?
        var progress: [String: ReadingPosition]
        var bookmarks: [String: ReadingPosition]
        var lastRead: ReadingTarget?
        var shelf: ShelfContext? = nil
    }

    init(archive: Archive, index: AtlasIndex, defaults: UserDefaults = .standard) {
        self.archive = archive
        self.index = index
        self.defaults = defaults
        let stored = defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(Saved.self, from: $0) }
        let saved = stored?.schema == 2 ? stored : nil
        let recovered = saved ?? Self.migrate(defaults)
        var exploration = recovered.explore
        if !Chronology.accepts(exploration.year) { exploration.year = 1500 }
        exploration.camera = exploration.camera.normalized()
        explore = exploration
        preferences = recovered.preferences
        progress = recovered.progress
        bookmarks = recovered.bookmarks
        lastRead = recovered.lastRead
        shelf = recovered.shelf ?? ShelfContext()
        if let previous = recovered.reading {
            let valid = previous.nodes.compactMap { node -> ReadingNode? in
                guard let volume = archive.volume(node.target.volume) else { return nil }
                let chapter = volume.chapter(node.target.chapter)
                return ReadingNode(volume: volume.id, chapter: chapter?.id, entryYear: node.entryYear,
                                   focusBlock: chapter == nil ? nil : node.focusBlock)
            }
            if !valid.isEmpty { reading = ReadingSession(nodes: valid, source: previous.source) }
        }
        if reading == nil, recovered.panel?.restorable == true { panel = recovered.panel }
    }

    private static func migrate(_ defaults: UserDefaults) -> Saved {
        var explore = ExploreSession()
        let year = defaults.integer(forKey: "exploreYear")
        if Chronology.accepts(year) { explore.year = year }
        if let name = defaults.string(forKey: "mapLayer"), let layer = GlobeLayer(rawValue: name) { explore.layer = layer }
        if let data = defaults.data(forKey: "exploreCamera"), let camera = try? JSONDecoder().decode(GlobeCamera.self, from: data) {
            explore.camera = camera
        }
        var preferences = Preferences()
        if let value = defaults.object(forKey: "showMapNames") as? Bool { preferences.showNames = value }
        if let value = defaults.object(forKey: "selectionHaptics") as? Bool { preferences.haptics = value }
        var progress: [String: ReadingPosition] = [:]
        for (key, value) in defaults.dictionaryRepresentation() where key.hasPrefix("readingAnchor:") {
            let pair = key.dropFirst("readingAnchor:".count).split(separator: "/", maxSplits: 1)
            guard pair.count == 2, let block = value as? String else { continue }
            let position = ReadingPosition(volume: String(pair[0]), chapter: String(pair[1]), block: block == "start" ? nil : block)
            progress[position.volume + "/" + position.chapter] = position
        }
        var last: ReadingTarget?
        var bookmarks: [String: ReadingPosition] = [:]
        if let volume = defaults.string(forKey: "lastReadingVolume"), !volume.isEmpty,
           let chapter = defaults.string(forKey: "lastReadingChapter"), !chapter.isEmpty {
            last = ReadingTarget(volume: volume, chapter: chapter)
            bookmarks[volume] = progress[volume + "/" + chapter] ?? ReadingPosition(volume: volume, chapter: chapter)
        }
        return Saved(explore: explore, preferences: preferences, reading: nil, panel: nil,
                     progress: progress, bookmarks: bookmarks, lastRead: last)
    }

    func position(volume: Volume, chapter: Chapter) -> ReadingPosition? {
        progress[volume.id + "/" + chapter.id] ??
            progress.values.first { position in
                (position.volume == volume.id || volume.aliases.contains(position.volume)) &&
                    (position.chapter == chapter.id || chapter.aliases.contains(position.chapter))
            }
    }

    func bookmark(for volume: Volume) -> ReadingPosition? {
        if let value = bookmarks[volume.id], volume.chapter(value.chapter) != nil { return value }
        for alias in volume.aliases {
            if let value = bookmarks[alias], volume.chapter(value.chapter) != nil { return value }
        }
        return nil
    }

    func record(_ position: ReadingPosition) {
        if var active = reading, let node = active.nodes.last, node.focusBlock != nil,
           node.target.volume == position.volume, node.target.chapter == position.chapter {
            active.nodes[active.nodes.count-1].focusBlock = nil
            reading = active
            scheduleSave()
        }
        let key = position.volume + "/" + position.chapter
        guard progress[key] != position || bookmarks[position.volume] != position else { return }
        progress[key] = position
        bookmarks[position.volume] = position
        let target = ReadingTarget(volume: position.volume, chapter: position.chapter)
        if lastRead != target { lastRead = target }
        scheduleSave()
    }

    func open(_ node: ReadingNode, from source: Companion? = nil) {
        guard let volume = archive.volume(node.target.volume) else { return }
        let chapter = volume.chapter(node.target.chapter)
        let normalized = ReadingNode(volume: volume.id, chapter: chapter?.id, entryYear: node.entryYear,
                                     focusBlock: node.focusBlock)
        if var previous = reading {
            if previous.nodes.last != normalized { previous.nodes.append(normalized) }
            reading = previous
        } else {
            reading = ReadingSession(nodes: [normalized], source: source ?? panel)
        }
        panel = nil
        save()
    }

    func switchChapter(_ node: ReadingNode) {
        guard var current = reading, !current.nodes.isEmpty else { return }
        current.nodes[current.nodes.count - 1] = node
        reading = current
        save()
    }

    func backInReading() {
        guard var current = reading else { return }
        if current.nodes.count > 1 {
            current.nodes.removeLast()
            reading = current
            save()
        } else {
            closeReading()
        }
    }

    func closeReading() {
        let source = reading?.source
        reading = nil
        panel = source?.restorable == true ? source : nil
        save()
    }

    func startObservation(_ subject: ObservationSession.Subject, stage: String? = nil, place: String? = nil,
                          source: Companion? = nil) {
        let origin: ObservationSession.Origin
        if let source { origin = .companion(source) }
        else if reading != nil { origin = .reading }
        else if let panel, panel.restorable { origin = .companion(panel) }
        else { origin = .exploration }
        observe = ObservationSession(subject: subject, origin: origin, stage: stage, selectedPlace: place)
        panel = nil
        save()
    }

    func updateObservation(stage: String? = nil, place: String? = nil, drawer: DrawerPosition? = nil) {
        guard var current = observe else { return }
        if let stage { current.stage = stage }
        if stage != nil || drawer == nil { current.selectedPlace = place }
        if let drawer { current.drawer = drawer }
        if current != observe { observe = current }
    }

    func endObservation() {
        guard let current = observe else { return }
        observe = nil
        if case .companion(let companion) = current.origin {
            panel = companion
        }
        save()
    }

    func reveal(_ mapID: String) {
        let subject = index.subjects[mapID]
        let candidate = subject?.from.map { max($0, index.coverage.from) }
        let year = mapID.hasPrefix("polity:") ? candidate : nil
        panel = nil
        reading = nil
        explore.selected = nil
        explore.layer = mapID.hasPrefix("country:") ? .countries : .timeline
        jump = MapJump(mapID: mapID, year: year.flatMap { Chronology.accepts($0) ? $0 : nil })
        save()
    }

    func setCamera(_ value: GlobeCamera) {
        guard value.isValid else { return }
        let camera = value.normalized()
        guard explore.camera != camera else { return }
        explore.camera = camera
        scheduleSave()
    }

    func consumeJump(_ request: MapJump) {
        if jump == request { jump = nil }
    }

    func scheduleSave() {
        pendingSave?.cancel()
        pendingSave = Task {
            try? await Task.sleep(nanoseconds: 280_000_000)
            guard !Task.isCancelled else { return }
            self.save()
        }
    }

    func save() {
        pendingSave?.cancel()
        pendingSave = nil
        let fromObservation: Companion?
        if case .companion(let route)? = observe?.origin { fromObservation = route } else { fromObservation = nil }
        let presented = fromObservation ?? (panel?.restorable == true ? panel : nil)
        let snapshot = Saved(explore: explore, preferences: preferences, reading: reading,
                             panel: presented, progress: progress, bookmarks: bookmarks, lastRead: lastRead, shelf:shelf)
        if let data = try? JSONEncoder().encode(snapshot) { defaults.set(data, forKey: Self.key) }
    }
}
