import SwiftUI

struct CompanionView: View {
    let content: AppContent
    @ObservedObject var session: SessionStore
    let kind: Companion

    var body: some View {
        switch kind {
        case .library:
            HistoricalLibrary(content:content,session:session)
        case .year(let year,let event):
            Almanac(content:content,session:session,year:year,initialEvent:event)
        case .options:
            PaperSheet(title:"设置与关于") {
                Toggle("显示地名",isOn:$session.preferences.showNames).tint(Design.vermilion)
                Toggle("触感反馈",isOn:$session.preferences.haptics).tint(Design.vermilion)
                Divider()
                HStack {
                    Text("地球空闲自转").accessibilityHidden(true)
                    Spacer()
                    Toggle("地球空闲自转",isOn:$session.preferences.idleRotation)
                        .labelsHidden()
                        .tint(Design.vermilion)
                        .accessibilityIdentifier("idle-rotation-toggle")
                }
                VStack(alignment:.leading,spacing:3) {
                    HStack {
                        Text("自转速度")
                        Spacer()
                        Text(session.preferences.idleRotationSpeed.formatted(.number.precision(.fractionLength(0...2))) + "×")
                            .monospacedDigit()
                            .foregroundStyle(Design.quiet)
                    }
                    Slider(value:$session.preferences.idleRotationSpeed,in:GlobeIdleMotion.speedRange,step:0.25) {
                        Text("自转速度")
                    } minimumValueLabel: {
                        Text("0.5×").font(.caption)
                    } maximumValueLabel: {
                        Text("2×").font(.caption)
                    }
                    .tint(Design.vermilion)
                    .accessibilityIdentifier("idle-rotation-speed")
                }
                .disabled(!session.preferences.idleRotation)
                Divider()
                ReadingSettings(preferences:$session.preferences)
                Divider()
                version
                DisclosureGroup("来源与许可") { MapSources(index:content.index) }.tint(Design.indigo)
            }
        case .sources:
            PaperSheet(title:"地图资料") { MapSources(index:content.index) }
        case .mapChoices(let ids):
            PaperSheet(title:"地图记录") {
                ForEach(ids,id:\.self) { id in
                    if let subject = content.index.subjects[id] {
                        PaperAction(title:subject.name,symbol:"map") { session.reveal(id) }
                    }
                }
            }
        }
    }

    private var version: some View {
        let app = Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "—"
        return VStack(alignment:.leading,spacing:6) {
            Text("时空地球 · \(app)").font(.headline)
            Text("离线内容 \(content.history.manifest.contentVersion)").font(.footnote).monospaced()
            Text("数据结构 \(content.history.manifest.schemaVersion)").font(.footnote)
        }
        .foregroundStyle(Design.quiet)
    }
}

private struct MapSources: View {
    let index: AtlasIndex
    var body: some View {
        ForEach(index.mapSources.keys.sorted(),id:\.self) { key in
            if let source = index.mapSources[key] {
                VStack(alignment:.leading,spacing:6) {
                    Link(source.name,destination:source.source).foregroundStyle(Design.indigo)
                    if let license = source.license { Text(license).font(.footnote) }
                    if let note = source.limitations { Text(note).font(.footnote).foregroundStyle(Design.quiet) }
                }
                Divider()
            }
        }
        Link("地表与云层资料署名",destination:URL(string:"https://github.com/lllliam/spacetime-globe#数据来源与许可")!)
            .font(.subheadline).foregroundStyle(Design.indigo)
    }
}

private struct HistoricalLibrary: View {
    let content: AppContent
    @ObservedObject var session: SessionStore
    @State private var results: [SearchResult] = []
    @State private var settledQuery = ""
    @Environment(\.dismiss) private var dismiss

    private enum ShelfSection: String, CaseIterable, Identifiable {
        case volumes = "书卷", topics = "专题"
        var id: String { rawValue }
    }
    private var query: String { session.shelf.query }
    private var region: String? { session.shelf.region }
    private var period: HistoricalPeriod? { session.shelf.period }
    private var section: Binding<ShelfSection> {
        Binding(get:{ session.shelf.showTopics ? .topics : .volumes },set:{ session.shelf.showTopics = $0 == .topics })
    }

    var body: some View {
        if let event = session.shelf.event, let yearHit = content.archive.event(event) {
            PaperSheet(title:yearHit.title,subtitle:yearHit.dateText) {
                PaperAction(title:"返回搜索",symbol:"chevron.backward") { session.shelf.event = nil }
                EventDetails(content:content,session:session,event:yearHit,year:yearHit.from,source:.library)
            }
        } else {
            shelf
        }
    }

    private var shelf: some View {
        VStack(spacing:0) {
            HStack(alignment:.top) {
                PaperHeader(title:"历史书目")
                IconAction(icon:"xmark",label:"关闭书目",tint:Design.quiet) { dismiss() }
            }
            .padding(.horizontal,Design.inset).padding(.top,22)
            HStack(spacing:8) {
                Image(systemName:"magnifyingglass").foregroundStyle(Design.quiet)
                TextField("搜索书卷、主体、史事或现场",text:$session.shelf.query)
                    .textFieldStyle(.plain).font(.subheadline).submitLabel(.search)
                    .accessibilityIdentifier("library-search")
                if !query.isEmpty {
                    IconAction(icon:"xmark.circle.fill",label:"清空搜索",tint:Design.quiet) { session.shelf.query = "" }
                        .frame(height:34)
                }
            }
            .padding(.horizontal,11).frame(minHeight:44)
            .background(Design.quiet.opacity(0.08),in:RoundedRectangle(cornerRadius:8))
            .padding(.horizontal,Design.inset).padding(.vertical,13)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment:.leading,spacing:13) {
                        if query.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {
                            browsing
                        } else if settledQuery == query {
                            if results.isEmpty { Text("没有找到相关内容").font(.subheadline).foregroundStyle(Design.quiet) }
                            ForEach(results) { result in
                                ShelfRow(title:result.title,label:result.detail) { open(result) }.id(result.id)
                            }
                        } else {
                            ProgressView().tint(Design.vermilion)
                        }
                    }
                    .padding(.horizontal,Design.inset).padding(.bottom,24)
                }
                .scrollDismissesKeyboard(.interactively)
                .onAppear { if let row = session.shelf.row { proxy.scrollTo(row,anchor:.center) } }
                .onChange(of:settledQuery) { _ in
                    if let row = session.shelf.row { proxy.scrollTo(row,anchor:.center) }
                }
            }
        }
        .foregroundStyle(Design.ink).background(Design.paper.ignoresSafeArea())
        .preferredColorScheme(.light)
        .task(id:query) {
            let text = query
            if text.isEmpty { results = []; settledQuery = text; return }
            do {
                try await Task.sleep(nanoseconds:135_000_000)
                let engine = content.search
                let task = Task.detached(priority:.userInitiated) { engine.find(text) }
                let matches = await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
                try Task.checkCancellation()
                results = matches
                settledQuery = text
            } catch { return }
        }
    }

    @ViewBuilder private var browsing: some View {
        if let recent = session.lastRead, let volume = content.archive.volume(recent.volume), let chapter = volume.chapter(recent.chapter) {
            PaperAction(title:"继续阅读 · " + volume.title,symbol:"bookmark.fill",prominent:true) {
                session.open(ReadingNode(volume:volume.id,chapter:chapter.id),from:.library)
            }
            Text(chapter.title).font(.caption).foregroundStyle(Design.quiet)
            Divider()
        }
        Picker("书目",selection:section) { ForEach(ShelfSection.allCases) { Text($0.rawValue).tag($0) } }
            .pickerStyle(.segmented)
        HStack(spacing:20) {
            Menu {
                Button("全部地区") { session.shelf.region = nil }
                ForEach(regions,id:\.self) { region in Button(region) { session.shelf.region = region } }
                Button("未标注地区") { session.shelf.region = "" }
            } label: {
                Label(region == "" ? "未标注地区" : region ?? "全部地区",systemImage:"globe")
                    .frame(minHeight:40)
            }
            Menu {
                Button("全部时期") { session.shelf.period = nil }
                ForEach(HistoricalPeriod.allCases) { period in Button(period.title) { session.shelf.period = period } }
            } label: {
                Label(period?.title ?? "全部时期",systemImage:"clock").frame(minHeight:40)
            }
        }
        .font(.subheadline).foregroundStyle(Design.indigo)
        let filtered = content.archive.volumes.filter { volume in
            let matchingRegion = region == nil || (region == "" ? volume.regions.isEmpty : volume.regions.contains(region ?? ""))
            return volume.isTopic == session.shelf.showTopics && matchingRegion && (period?.includes(volume) ?? true)
        }
        if filtered.isEmpty { Text("这个范围内暂未收录书卷或专题").font(.footnote).foregroundStyle(Design.quiet) }
        ForEach(filtered) { volume in
            ShelfRow(title:volume.title,label:volume.dateText) {
                session.shelf.row = volume.id
                session.open(ReadingNode(volume:volume.id,entryYear:session.explore.year),from:.library)
            }
            .id(volume.id)
        }
    }

    private var regions: [String] { Array(Set(content.archive.volumes.flatMap(\.regions))).sorted() }

    private func open(_ result: SearchResult) {
        session.shelf.row = result.id
        switch result.destination {
        case .volume(let id):
            session.open(ReadingNode(volume:id,entryYear:session.explore.year),from:.library)
        case .chapter(let volume,let chapter):
            session.open(ReadingNode(volume:volume,chapter:chapter,entryYear:session.explore.year),from:.library)
        case .subject(let mapID):
            session.reveal(mapID)
        case .event(let id):
            session.shelf.event = id
        case .scene(let id):
            session.startObservation(.scene(id),source:.library)
        }
    }
}

private struct ShelfRow: View {
    let title: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action:action) {
            HStack(alignment:.firstTextBaseline) {
                VStack(alignment:.leading,spacing:5) {
                    Text(title).font(.system(.headline,design:.serif))
                    Text(label).font(.caption).foregroundStyle(Design.quiet)
                }
                Spacer(minLength:5)
                Image(systemName:"chevron.forward").font(.caption).foregroundStyle(Design.indigo)
            }
            .padding(.vertical,9).frame(minHeight:44).frame(maxWidth:.infinity,alignment:.leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Design.ink)
        .background(alignment:.bottom) { Design.rule.frame(height:1) }
    }
}

private struct Almanac: View {
    let content: AppContent
    @ObservedObject var session: SessionStore
    let year: Int
    @State private var current: String?
    @State private var last: String?
    @Environment(\.dismiss) private var dismiss

    init(content: AppContent,session: SessionStore,year: Int,initialEvent: String?) {
        self.content = content
        self.session = session
        self.year = year
        _current = State(initialValue:initialEvent)
        _last = State(initialValue:initialEvent)
    }

    var body: some View {
        if let current, let event = content.archive.event(current) {
            PaperSheet(title:event.title,subtitle:event.dateText) {
                PaperAction(title:"返回 \(eraYear(year)) 年史事",symbol:"chevron.backward") { self.current = nil }
                EventDetails(content:content,session:session,event:event,year:year,source:.year(year,event:event.id))
            }
        } else {
            VStack(spacing:0) {
                let events = content.archive.events(in:year)
                let related = context(for:events)
                HStack(alignment:.top) {
                    PaperHeader(title:"这一年的世界",subtitle:"\(eraYear(year)) 年")
                    IconAction(icon:"xmark",label:"关闭史事",tint:Design.quiet) { dismiss() }
                }
                .padding(.horizontal,Design.inset).padding(.top,22).padding(.bottom,14)
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment:.leading,spacing:12) {
                            if events.isEmpty { Text("这一年暂未收录史事").foregroundStyle(Design.quiet) }
                            timelineGroup(title:"当年史事",events:events.filter { !$0.background })
                            timelineGroup(title:"历史背景",events:events.filter(\.background))
                            if !related.subjects.isEmpty {
                                groupTitle("历史主体")
                                ForEach(related.subjects) { item in
                                    ShelfRow(title:item.subject.name,label:item.volume.title) {
                                        session.open(ReadingNode(volume:item.volume.id,chapter:item.chapter,entryYear:year),
                                                     from:.year(year))
                                    }
                                }
                            }
                            if !related.books.isEmpty {
                                groupTitle("相关书卷")
                                ForEach(related.books) { item in
                                    ShelfRow(title:item.volume.title,label:item.volume.chapter(item.chapter)?.title ?? item.volume.dateText) {
                                        session.open(ReadingNode(volume:item.volume.id,chapter:item.chapter,entryYear:year),
                                                     from:.year(year))
                                    }
                                }
                            }
                            if !related.scenes.isEmpty {
                                groupTitle("历史观察现场")
                                ForEach(related.scenes) { item in
                                    ShelfRow(title:item.scene.title,label:item.frame?.dateLabel ?? "\(eraYear(item.frame?.year ?? item.scene.year)) 年") {
                                        session.startObservation(.scene(item.scene.id),stage:item.frame?.id,source:.year(year))
                                    }
                                }
                            }
                        }
                        .padding(.horizontal,Design.inset).padding(.bottom,25)
                    }
                    .onAppear { if let last { proxy.scrollTo(last,anchor:.center) } }
                }
            }
            .foregroundStyle(Design.ink).background(Design.paper.ignoresSafeArea())
            .preferredColorScheme(.light)
            .accessibilityIdentifier("year-almanac")
        }
    }

    private struct RelatedBook: Identifiable {
        let volume: Volume
        let chapter: String?
        var id: String { volume.id }
    }

    private struct RelatedSubject: Identifiable {
        let subject: AtlasIndex.Subject
        let book: RelatedBook
        var id: String { subject.id }
        var volume: Volume { book.volume }
        var chapter: String? { book.chapter }
    }

    private struct RelatedScene: Identifiable {
        let scene: HistoryScene
        let frame: SceneFrame?
        var id: String { scene.id }
    }

    private func context(for events: [HistoryEvent]) -> (subjects:[RelatedSubject],books:[RelatedBook],scenes:[RelatedScene]) {
        var subjectIDs = Set<String>()
        let subjects: [RelatedSubject] = content.index.books.keys.sorted().compactMap { mapID in
            guard mapID.hasPrefix("polity:"), let subject = content.index.subjects[mapID],
                  let from = subject.from, from <= year, year <= (subject.to ?? year),
                  let binding = content.index.bindings(mapID,in:year).first(where:{ $0.relation == "primary" }),
                  let volume = content.archive.volume(binding.volume),
                  subjectIDs.insert(subject.id).inserted else { return nil }
            return RelatedSubject(subject:subject,book:RelatedBook(volume:volume,chapter:binding.chapter))
        }.sorted { $0.subject.name.localizedStandardCompare($1.subject.name) == .orderedAscending }
        var bookIDs = Set(subjects.map(\.volume.id))
        let books = events.flatMap(\.reading).compactMap { item -> RelatedBook? in
            guard let volume = content.archive.volume(item.volume), bookIDs.insert(volume.id).inserted else { return nil }
            return RelatedBook(volume:volume,chapter:item.chapter)
        }
        let eventScenes = Set(events.compactMap(\.scene))
        let scenes = content.archive.scenes.compactMap { scene -> RelatedScene? in
            guard scene.status == "available" else { return nil }
            let frame = scene.frames.first { $0.year == year }
            guard frame != nil || scene.year == year || eventScenes.contains(scene.id) else { return nil }
            return RelatedScene(scene:scene,frame:frame ?? scene.frames.first)
        }
        return (subjects,books,scenes)
    }

    private func groupTitle(_ title: String) -> some View {
        Text(title).font(.subheadline.weight(.semibold))
            .padding(.top,10).accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder private func timelineGroup(title: String,events: [HistoryEvent]) -> some View {
        if !events.isEmpty {
            groupTitle("\(title) · \(events.count)")
            ForEach(events) { event in
                ShelfRow(title:event.title,label:([event.dateText] + Array(event.regions.prefix(2))).joined(separator:" · ")) {
                    last = event.id
                    current = event.id
                }
                .id(event.id)
            }
        }
    }
}

private struct EventDetails: View {
    let content: AppContent
    @ObservedObject var session: SessionStore
    let event: HistoryEvent
    let year: Int
    let source: Companion

    var body: some View {
        if !event.regions.isEmpty { Text(event.regions.joined(separator:" · ")).font(.footnote).foregroundStyle(Design.quiet) }
        if let annotation = event.annotation {
            if let summary = annotation.summary { Text(summary).font(.headline) }
            ForEach(annotation.blocks) { block in
                if let heading = block.heading { Text(heading).font(.headline) }
                Text(block.text).font(Design.font(18)).lineSpacing(6).textSelection(.enabled)
                if !block.refs.isEmpty {
                    DisclosureGroup("史料依据") { EvidenceDetails(evidence:block.refs,sources:annotation.sources) }
                        .font(.footnote)
                }
            }
        }
        ForEach(event.reading) { target in
            if let volume = content.archive.volume(target.volume) {
                PaperAction(title:volume.chapter(target.chapter)?.title ?? volume.title,symbol:"book") {
                    session.open(ReadingNode(volume:volume.id,chapter:target.chapter,entryYear:year),from:source)
                }
            }
        }
        if let sceneID = event.scene, let scene = content.archive.scene(sceneID) {
            PaperAction(title:scene.title,symbol:"map") { session.startObservation(.scene(sceneID),source:source) }
                .accessibilityIdentifier("event-observation")
        } else if event.lon != nil, event.lat != nil {
            PaperAction(title:"查看相关区域",symbol:"mappin") { session.startObservation(.event(event.id,year),source:source) }
                .accessibilityIdentifier("event-observation")
        }
        if !event.sources.isEmpty || event.annotation?.sources.isEmpty == false {
            Divider()
            Text("资料来源").font(.subheadline.weight(.semibold))
            ForEach(event.annotation?.sources ?? []) { SourceLine(source:$0) }
            ForEach(event.sources,id:\.self) { address in
                if let url = sourceURL(address) {
                    Link(url.host ?? address,destination:url).font(.footnote).foregroundStyle(Design.indigo)
                } else { Text(address).font(.footnote).foregroundStyle(Design.quiet) }
            }
        }
    }
}
