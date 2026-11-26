import SwiftUI

enum ReaderDestination: Hashable {
    case volume(String)
    case chapter(String, String)
    case scene(String, String?)
    case event(String)
}

struct ReadingLaunch: Identifiable {
    enum Root { case library, events(Int) }
    let id = UUID()
    let root: Root
    var path: [ReaderDestination] = []
}

struct ReadingFlow: View {
    let history: OfflineHistory
    let atlas: GlobeAtlas
    let launch: ReadingLaunch
    @State private var path: [ReaderDestination]
    @Environment(\.dismiss) private var dismiss

    init(history: OfflineHistory, atlas: GlobeAtlas, launch: ReadingLaunch) {
        self.history = history
        self.atlas = atlas
        self.launch = launch
        _path = State(initialValue: launch.path)
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                switch launch.root {
                case .library: LibraryShelf(archive: history.archive)
                case .events(let year): EventList(archive: history.archive, year: year)
                }
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("返回地球") { dismiss() } } }
            .navigationDestination(for: ReaderDestination.self) { destination in
                switch destination {
                case .volume(let id):
                    if let volume = history.archive.volume(id) {
                        VolumeView(volume: volume)
                    } else { missing }
                case .chapter(let id, let chapterId):
                    if let volume = history.archive.volume(id), let chapter = volume.chapters.first(where: { $0.id == chapterId }) {
                        ChapterView(volume: volume, chapter: chapter, archive: history.archive) { next in
                            if path.last == destination { path[path.count - 1] = .chapter(id, next) }
                        }
                        .id(chapterId)
                    } else { missing }
                case .scene(let id, let stage):
                    if let scene = history.archive.scene(id) {
                        ObservationView(scene: scene, stage: stage, atlas: atlas, resources: history.resources)
                    } else { missing }
                case .event(let id):
                    if let event = history.archive.event(id) {
                        EventView(event: event, archive: history.archive)
                    } else { missing }
                }
            }
        }
        .preferredColorScheme(.light)
        .tint(Color(red: 0.53, green: 0.22, blue: 0.13))
    }

    private var missing: some View {
        Label("找不到对应资料", systemImage: "book.closed")
    }
}

private let paper = Color(red: 0.965, green: 0.947, blue: 0.905)

private struct LibraryShelf: View {
    let archive: Archive
    @State private var query = ""

    var body: some View {
        List {
            Section("书卷") { rows(topics: false) }
            Section("专题") { rows(topics: true) }
        }
        .searchable(text: $query, prompt: "搜索书卷或章节")
        .navigationTitle("历史书架")
    }

    private func rows(topics: Bool) -> some View {
        ForEach(archive.volumes.filter {
            $0.isTopic == topics && (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query)
                                     || $0.chapters.contains { $0.title.localizedCaseInsensitiveContains(query) })
        }) { volume in
            NavigationLink(value: ReaderDestination.volume(volume.id)) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(volume.title).font(.headline)
                    Text(volume.dateText).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct VolumeView: View {
    let volume: Volume

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Text(volume.dateText).font(.subheadline).foregroundStyle(.secondary)
                    if let summary = volume.summary { Text(summary) }
                    if let notice = volume.notice { Text(notice).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            Section("目录") {
                ForEach(volume.chapters) { chapter in
                    NavigationLink(value: ReaderDestination.chapter(volume.id, chapter.id)) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(chapter.title)
                            Text(chapter.dateText).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle(volume.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct ReadingAnchor: PreferenceKey {
    static let defaultValue: [String: CGFloat] = [:]
    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { _, latest in latest })
    }
}

private struct ChapterView: View {
    let volume: Volume
    let chapter: Chapter
    let archive: Archive
    let goToChapter: (String) -> Void
    @AppStorage("lastReadingVolume") private var lastVolume = ""
    @AppStorage("lastReadingChapter") private var lastChapter = ""
    @State private var restored = false
    @State private var lastSaved = ""
    @ScaledMetric(relativeTo: .body) private var textSize = 19.0
    private var scrollKey: String { "readingAnchor:" + volume.id + "/" + chapter.id }
    private var chapters: [Chapter] { volume.chapters }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 9) {
                        Text(volume.title + " · " + chapter.dateText).font(.subheadline).foregroundStyle(.secondary)
                        Text(chapter.title).font(.system(.largeTitle, design: .serif, weight: .bold))
                            .accessibilityAddTraits(.isHeader)
                        if let summary = chapter.summary { Text(summary).font(.headline) }
                        if let scope = chapter.scope { Text(scope).font(.footnote).foregroundStyle(.secondary) }
                    }
                    .background(anchor("start"))
                    .id("start")
                    if let thesis = chapter.thesis {
                        Text(thesis).font(.subheadline).italic().padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.brown.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
                    }
                    ForEach(chapter.blocks) { block in
                        VStack(alignment: .leading, spacing: 12) {
                            if let heading = block.heading {
                                Text(heading).font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
                            }
                            Text(block.text).font(.system(size: textSize, design: .serif)).lineSpacing(7)
                                .textSelection(.enabled)
                            EvidenceList(references: block.refs, sources: chapter.sources)
                            if let callout = block.callout {
                                VStack(alignment: .leading, spacing: 8) {
                                    if let heading = callout.title ?? callout.label { Text(heading).font(.headline) }
                                    Text(callout.text)
                                    EvidenceList(references: callout.refs, sources: chapter.sources)
                                }
                                .padding(14)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(.brown.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
                            }
                            ForEach(Array(chapter.scenes.filter { $0.afterBlockId == block.id }.enumerated()), id: \.offset) {
                                sceneLink($0.element)
                            }
                        }
                        .background(anchor(block.id))
                        .id(block.id)
                    }
                    ForEach(Array(chapter.scenes.filter { $0.afterBlockId == nil }.enumerated()), id: \.offset) {
                        sceneLink($0.element)
                    }
                    if !chapter.links.isEmpty {
                        Divider()
                        Text("延伸阅读").font(.headline)
                        ForEach(chapter.links) { link in
                            if let target = archive.volume(link.volume) {
                                let route = link.chapter.map { ReaderDestination.chapter(target.id, $0) } ?? .volume(target.id)
                                VStack(alignment: .leading, spacing: 5) {
                                    NavigationLink(link.label ?? target.title, value: route)
                                    if let note = link.note { Text(note).font(.footnote).foregroundStyle(.secondary) }
                                    EvidenceList(references: link.refs, sources: chapter.sources)
                                }
                            }
                        }
                    }
                    if !chapter.sources.isEmpty {
                        DisclosureGroup("本章来源") {
                            VStack(alignment: .leading, spacing: 12) {
                                ForEach(chapter.sources) { SourceLine(source: $0) }
                            }
                            .padding(.vertical, 12)
                        }
                    }
                    chapterControls
                }
                .frame(maxWidth: 620, alignment: .leading)
                .padding(.horizontal, 24).padding(.vertical, 18)
                .frame(maxWidth: .infinity)
            }
            .coordinateSpace(name: scrollKey)
            .background(paper.ignoresSafeArea())
            .onPreferenceChange(ReadingAnchor.self) { offsets in
                guard restored, let visible = offsets.filter({ $0.value <= 8 }).max(by: { $0.value < $1.value }),
                      visible.key != lastSaved else { return }
                lastSaved = visible.key
                UserDefaults.standard.set(visible.key, forKey: scrollKey)
            }
            .task {
                lastVolume = volume.id
                lastChapter = chapter.id
                guard !restored else { return }
                lastSaved = UserDefaults.standard.string(forKey: scrollKey) ?? "start"
                await Task.yield()
                guard !Task.isCancelled else { return }
                if lastSaved != "start", chapter.blocks.contains(where: { $0.id == lastSaved }) {
                    proxy.scrollTo(lastSaved, anchor: .top)
                }
                restored = true
            }
        }
        .navigationTitle("阅读")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func anchor(_ id: String) -> some View {
        GeometryReader { proxy in
            Color.clear.preference(key: ReadingAnchor.self, value: [id: proxy.frame(in: .named(scrollKey)).minY])
        }
    }

    @ViewBuilder private func sceneLink(_ ref: SceneRef) -> some View {
        if let scene = archive.scene(ref.id) {
            NavigationLink(value: ReaderDestination.scene(ref.id, ref.stageId)) {
                Label(scene.title, systemImage: "map").font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.bordered)
        }
    }

    private var chapterControls: some View {
        HStack {
            if let index = chapters.firstIndex(where: { $0.id == chapter.id }) {
                if index > 0 { Button("上一章") { goToChapter(chapters[index - 1].id) } }
                Spacer()
                if index + 1 < chapters.count { Button("下一章") { goToChapter(chapters[index + 1].id) } }
            }
        }
        .buttonStyle(.bordered)
        .padding(.vertical, 12)
    }
}

private struct SourceLine: View {
    let source: HistorySource
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let url = source.link {
                Link(source.title, destination: url)
            } else { Text(source.title) }
            if let note = source.note { Text(note).foregroundStyle(.secondary) }
        }
        .font(.footnote)
    }
}

private struct EvidenceList: View {
    let references: [Evidence]
    let sources: [HistorySource]
    var body: some View {
        if !references.isEmpty {
            DisclosureGroup("段落依据") {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(references.enumerated()), id: \.offset) { entry in
                        let ref = entry.element
                        VStack(alignment: .leading, spacing: 4) {
                            if let source = sources.first(where: { $0.id == ref.sourceId }) {
                                SourceLine(source: source)
                            } else { Text(ref.sourceId) }
                            if let locator = ref.locator { Text(locator) }
                            if let note = ref.note { Text(note).foregroundStyle(.secondary) }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
            }
            .font(.footnote)
        }
    }
}

private struct EventList: View {
    let archive: Archive
    let year: Int
    var body: some View {
        let events = archive.events(in: year)
        List {
            if events.isEmpty { Text("这一年没有收录事件").foregroundStyle(.secondary) }
            Section("事件") { rows(events.filter { !$0.background }) }
            Section("长期背景") { rows(events.filter(\.background)) }
        }
        .navigationTitle("\(eraYear(year)) 年")
    }

    private func rows(_ events: [HistoryEvent]) -> some View {
        ForEach(events) { event in
            NavigationLink(value: ReaderDestination.event(event.id)) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(event.title)
                    Text(yearRange(event.from, event.to)).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct EventView: View {
    let event: HistoryEvent
    let archive: Archive

    var body: some View {
        List {
            Section {
                Text(event.title).font(.title2.weight(.semibold))
                Text(yearRange(event.from, event.to))
                if !event.regions.isEmpty { Text(event.regions.joined(separator: " · ")).foregroundStyle(.secondary) }
            }
            if !event.reading.isEmpty || event.scene.flatMap(archive.scene) != nil {
                Section("阅读与现场") {
                    ForEach(event.reading) { target in
                        if let volume = archive.volume(target.volume) {
                            let title = volume.chapters.first { $0.id == target.chapter }?.title
                            let route = target.chapter.map { ReaderDestination.chapter(volume.id, $0) } ?? .volume(volume.id)
                            NavigationLink(title ?? volume.title, value: route)
                        }
                    }
                    if let id = event.scene, let scene = archive.scene(id) {
                        NavigationLink(scene.title, value: ReaderDestination.scene(id, nil))
                    }
                }
            }
            if !event.sources.isEmpty {
                Section("资料来源") {
                    ForEach(event.sources, id: \.self) { Text($0).font(.footnote) }
                }
            }
        }
        .navigationTitle("事件")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct ObservationView: View {
    let scene: HistoryScene
    let atlas: GlobeAtlas
    let resources: URL
    @State private var frameId: String
    @State private var camera = GlobeCamera(verticalCenter: 0.5)
    @State private var region: MapRegion?
    @AppStorage("selectionHaptics") private var haptics = true

    init(scene: HistoryScene, stage: String?, atlas: GlobeAtlas, resources: URL) {
        self.scene = scene
        self.atlas = atlas
        self.resources = resources
        _frameId = State(initialValue: scene.frames.first { $0.id == stage }?.id ?? scene.frames.first?.id ?? "")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 15) {
                if let question = scene.question { Text(question).font(.headline) }
                if let frame = scene.frames.first(where: { $0.id == frameId }) {
                    if scene.frames.count > 1 {
                        Picker("现场阶段", selection: $frameId) {
                            ForEach(scene.frames) { Text($0.title).tag($0.id) }
                        }
                        .pickerStyle(.menu)
                    }
                    Text(frame.dateLabel ?? (eraYear(frame.year) + " 年")).font(.subheadline).foregroundStyle(.secondary)
                    NativeGlobe(atlas: atlas, resources: resources,
                                request: AtlasRequest(layer: scene.naturalOnly == true ? .terrain : .timeline,
                                                      year: frame.year, selected: region?.id),
                                camera: $camera, showNames: false, places: frame.places, routes: frame.routes,
                                onZoomLimit: { if haptics { GlobeHaptics.boundary() } },
                                onRegion: { selected in
                        if selected?.id != region?.id, selected != nil, haptics { GlobeHaptics.selection() }
                        region = selected
                    })
                    .frame(height: 310)
                    .clipShape(RoundedRectangle(cornerRadius: 15))
                    if let region { Text(region.name + " · " + region.dates).font(.caption) }
                    if let note = frame.note ?? scene.note { Text(note) }
                    EvidenceList(references: frame.evidence ?? [], sources: scene.sources)
                    ForEach(frame.places) { place in
                        VStack(alignment: .leading, spacing: 5) {
                            Button {
                                camera.center(longitude: place.lon, latitude: place.lat, zoom: 3.5)
                                if haptics { GlobeHaptics.selection() }
                            } label: { Label(place.name, systemImage: "mappin.circle") }
                            .font(.headline)
                            if let note = place.note { Text(note).font(.subheadline) }
                            EvidenceList(references: place.evidence ?? [], sources: scene.sources)
                        }
                    }
                    ForEach(frame.routes) { route in
                        VStack(alignment: .leading, spacing: 5) {
                            Label(route.label, systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                                .font(.headline)
                            if let note = route.note { Text(note).font(.subheadline) }
                        }
                    }
                    if let limit = scene.limit { Text(limit).font(.footnote).foregroundStyle(.secondary) }
                    ForEach(scene.sources) { SourceLine(source: $0) }
                }
            }
            .padding()
        }
        .background(paper.ignoresSafeArea())
        .navigationTitle(scene.title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: resetCamera)
        .onChange(of: frameId) { _ in
            resetCamera()
            if haptics { GlobeHaptics.selection() }
        }
    }

    private func resetCamera() {
        region = nil
        guard let places = scene.frames.first(where: { $0.id == frameId })?.places, let first = places.first else { return }
        var extent = 0.0
        for place in places {
            let longitude = place.lon - first.lon + 540.0
            let wrapped = longitude.truncatingRemainder(dividingBy: 360.0) - 180.0
            extent = max(extent, abs(wrapped) + abs(place.lat - first.lat))
        }
        camera.center(longitude: first.lon, latitude: first.lat, zoom: extent > 38 ? 1.3 : 2.6)
    }
}
