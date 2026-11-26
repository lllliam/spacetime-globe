import Foundation

struct SearchResult: Identifiable {
    enum Destination {
        case volume(String)
        case chapter(String, String)
        case subject(String)
        case event(String)
        case scene(String)
    }
    let id: String
    let title: String
    let detail: String
    let destination: Destination
}

struct HistorySearch {
    private struct Entry {
        let result: SearchResult
        let title: String
        let terms: String
    }
    private let entries: [Entry]

    init(archive: Archive, index: AtlasIndex) {
        var results: [Entry] = []
        func append(_ id: String, _ title: String, _ detail: String, _ destination: SearchResult.Destination, _ aliases: [String]) {
            let item = SearchResult(id: id, title: title, detail: detail, destination: destination)
            results.append(Entry(result: item, title: Self.normalize(title),
                                 terms: Self.normalize(([title, detail] + aliases).joined(separator: " "))))
        }
        for volume in archive.volumes {
            append("v/" + volume.id, volume.title, volume.isTopic ? "专题" : "书卷", .volume(volume.id), volume.aliases + volume.regions)
            for chapter in volume.chapters {
                append("c/" + volume.id + "/" + chapter.id, chapter.title, volume.title, .chapter(volume.id,chapter.id), chapter.aliases)
            }
        }
        var subjects = Set<String>()
        for (mapID, subject) in index.subjects.sorted(by: { lhs,rhs in lhs.key > rhs.key }) where subjects.insert(subject.id).inserted {
            append("s/" + subject.id, subject.name, "历史主体", .subject(mapID), subject.aliases)
        }
        for (rawName, label) in index.names.sorted(by: { $0.key < $1.key }) {
            let mapID = "polity:" + rawName
            if index.subjects[mapID] == nil && !index.relations.contains(rawName) {
                append("m/" + rawName, label, "历史底图记录", .subject(mapID), [rawName])
            }
        }
        for event in archive.events {
            append("e/" + event.id,event.title,event.dateText,.event(event.id),event.aliases)
        }
        for scene in archive.scenes where scene.status == "available" {
            append("o/" + scene.id,scene.title,"历史现场",.scene(scene.id),[])
        }
        entries = results
    }

    func find(_ query: String, limit: Int = 60) -> [SearchResult] {
        let query = Self.normalize(query)
        let tokens = query.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !tokens.isEmpty else { return [] }
        var found: [(Int,SearchResult)] = []
        for (offset, entry) in entries.enumerated() {
            if offset.isMultiple(of: 64), Task.isCancelled { return [] }
            guard tokens.allSatisfy(entry.terms.contains) else { continue }
            let score = entry.title == query ? 0 : entry.title.hasPrefix(query) ? 1 : entry.title.contains(query) ? 2 : 3
            found.append((score,entry.result))
        }
        return found.sorted {
            if $0.0 != $1.0 { return $0.0 < $1.0 }
            return $0.1.title.localizedStandardCompare($1.1.title) == .orderedAscending
        }.prefix(limit).map(\.1)
    }

    private static func normalize(_ text: String) -> String {
        text.folding(options: [.caseInsensitive,.diacriticInsensitive,.widthInsensitive], locale: Locale(identifier: "zh-Hans"))
    }
}

enum HistoricalPeriod: String, CaseIterable, Identifiable {
    case ancient, medieval, earlyModern, modern, contemporary
    var id: String { rawValue }
    var title: String {
        switch self {
        case .ancient: return "古代"
        case .medieval: return "中世时期"
        case .earlyModern: return "早期近世"
        case .modern: return "近代"
        case .contemporary: return "当代"
        }
    }
    var range: ClosedRange<Int> {
        switch self {
        case .ancient: return Chronology.first...499
        case .medieval: return 500...1499
        case .earlyModern: return 1500...1799
        case .modern: return 1800...1949
        case .contemporary: return 1950...Chronology.latest
        }
    }

    func includes(_ volume: Volume) -> Bool {
        volume.from <= range.upperBound && (volume.to ?? Int.max) >= range.lowerBound
    }
}
