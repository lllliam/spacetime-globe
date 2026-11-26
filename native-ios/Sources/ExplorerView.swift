import SwiftUI

struct ExplorerView: View {
    let content: AppContent
    @ObservedObject var session: SessionStore
    @StateObject private var viewport: GlobeViewport
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var preview: Int?
    @State private var requested: Int
    @State private var applied: AtlasKey?
    @State private var appliedMap: PaintedAtlas?
    @State private var picked: MapRegion?
    @State private var coincident: [MapRegion] = []
    @State private var yearEditor = false
    @State private var pendingJump: String?

    init(content: AppContent,session: SessionStore) {
        self.content = content
        self.session = session
        _viewport = StateObject(wrappedValue:GlobeViewport(session.explore.camera))
        _requested = State(initialValue:session.explore.year)
    }

    var body: some View {
        GeometryReader { geometry in
            let bottom = bottomInset(geometry.size.height)
            ZStack(alignment:.bottom) {
                NativeGlobe(cache:content.map,resources:content.resources,request:atlasRequest,viewport:viewport,
                            showNames:session.preferences.showNames,selected:picked?.id,
                            protectedTop:100,protectedBottom:bottom + geometry.safeAreaInsets.bottom,
                            haptics:session.preferences.haptics,onApplied:apply,onRegions:select,onSettled:saveCamera)
                    .ignoresSafeArea()
                VStack(spacing:0) {
                    header
                    Spacer(minLength:8)
                    if let picked {
                        MapDrawer(position:$session.explore.drawer, available:geometry.size.height, title:picked.name,
                                  subtitle:picked.dates, trailing:{
                            IconAction(icon:"xmark",label:"关闭疆域摘要",tint:Design.quiet) { select([]) }
                                .accessibilityIdentifier("close-region")
                        }, details:{
                            RegionDetails(region:picked,year:applied?.year ?? requested,coincident:coincident,content:content,
                                          onOpen:open,onSwitch:chooseDirectly,onSources:{ session.panel = .sources })
                        })
                        .accessibilityIdentifier("region-drawer")
                        .transition(.move(edge:.bottom).combined(with:.opacity))
                    } else {
                        footer
                    }
                }
            }
        }
        .background(Design.space.ignoresSafeArea())
        .sheet(isPresented:$yearEditor) {
            YearChooser(initial:preview ?? session.explore.year,scale:$session.explore.scale) { year in
                commit(year,feedback:true)
            }
            .presentationDetents([.medium,.large])
        }
        .task(id:preview) {
            guard let preview, preview != requested else { return }
            do { try await Task.sleep(nanoseconds:62_000_000); requested = preview } catch { return }
        }
        .onAppear { followJump(session.jump) }
        .onChange(of:session.jump) { followJump($0) }
        .onChange(of:session.explore.drawer) { _ in reframe(); session.scheduleSave() }
        .onChange(of:session.explore.layer) { _ in
            picked = nil
            coincident = []
            session.explore.selected = nil
            reframe()
            session.scheduleSave()
        }
        .onChange(of:session.explore.scale) { _ in session.scheduleSave() }
        .onDisappear { saveCamera(viewport.camera) }
    }

    private var atlasRequest: AtlasKey {
        let layer = content.atlas.hasHistory || session.explore.layer != .timeline ? session.explore.layer : .terrain
        return AtlasKey(layer:layer,year:requested)
    }

    private var header: some View {
        HStack(alignment:.top,spacing:4) {
            Button { yearEditor = true } label: {
                VStack(alignment:.leading,spacing:2) {
                    HStack(alignment:.firstTextBaseline,spacing:7) {
                        Text(eraYear(preview ?? session.explore.year))
                            .font(.system(.largeTitle,design:.serif,weight:.semibold))
                            .monospacedDigit().lineLimit(1).minimumScaleFactor(0.65)
                        Image(systemName:"chevron.down").font(.caption.weight(.semibold))
                    }
                    Text(mapCaption).font(.caption).foregroundStyle(.white.opacity(0.67))
                        .fixedSize(horizontal:false,vertical:true)
                }
                .frame(minHeight:44,alignment:.leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("选择年份")
            .accessibilityValue(eraYear(preview ?? session.explore.year) + " 年")
            .accessibilityIdentifier("choose-year")
            Spacer(minLength:0)
            Menu {
                Button { session.panel = .library } label: { Label("历史书目",systemImage:"books.vertical") }
                if let recent = session.lastRead {
                    Button { session.open(ReadingNode(volume:recent.volume,chapter:recent.chapter)) } label: {
                        Label("继续阅读",systemImage:"bookmark")
                    }
                }
                Picker("地图图层",selection:$session.explore.layer) {
                    ForEach(GlobeLayer.allCases) { Text($0.label).tag($0) }
                }
                Toggle("显示地名",isOn:$session.preferences.showNames)
                Button { resetView() } label: { Label("复位视角",systemImage:"globe") }
                Button { session.panel = .options } label: { Label("设置与关于",systemImage:"gearshape") }
            } label: {
                Image(systemName:"ellipsis").font(.system(size:22,weight:.semibold))
                    .frame(width:44,height:44).contentShape(Rectangle())
            }
            .accessibilityLabel("探索选项")
            .accessibilityIdentifier("explore-options")
        }
        .foregroundStyle(.white)
        .padding(.horizontal,Design.inset)
        .padding(.top,5)
    }

    private var mapCaption: String {
        if let actual = applied?.year, actual != (preview ?? session.explore.year) {
            return "地图仍显示 \(eraYear(actual)) 年"
        }
        if applied == nil { return "正在读取地图" }
        let layer = session.explore.layer
        if layer == .timeline && !content.atlas.hasHistory { return "疆域资料暂不可用 · 自然地形" }
        if layer == .timeline && !content.index.coverage.contains(requested) { return "超出疆域资料覆盖 · 自然地形" }
        return layer.label
    }

    private var footer: some View {
        VStack(spacing:1) {
            Button {
                if let year = applied?.year { session.panel = .year(year) }
            } label: {
                Label("这一年 · " + eraYear(applied?.year ?? session.explore.year),systemImage:"clock")
                    .font(.footnote.weight(.semibold)).foregroundStyle(Design.gold)
                    .frame(minHeight:44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(applied == nil || applied?.year != (preview ?? session.explore.year))
            .accessibilityIdentifier("open-almanac")
            HistoryTimeline(year:session.explore.year,scale:session.explore.scale,hasEvent:content.archive.hasEventStarting,
                            haptics:session.preferences.haptics,reduceMotion:reduceMotion,onPreview:{ preview = $0 },
                            onCommit:{ commit($0,feedback:false) })
                .frame(height:55)
        }
        .padding(.horizontal,15).padding(.bottom,5)
        .background {
            LinearGradient(colors:[.clear,Design.space.opacity(0.86),Design.space],startPoint:.top,endPoint:.bottom)
                .ignoresSafeArea(edges:.bottom).allowsHitTesting(false)
        }
    }

    private func commit(_ target: Int,feedback: Bool) {
        guard Chronology.accepts(target) else { return }
        let changed = target != session.explore.year
        requested = target
        preview = nil
        session.explore.year = target
        if changed && feedback && session.preferences.haptics { GlobeHaptics.selection() }
        session.save()
    }

    private func apply(_ key: AtlasKey,_ map: PaintedAtlas) {
        guard key.year == requested, key.layer == atlasRequest.layer else { return }
        applied = key
        appliedMap = map
        if let pendingJump, let shape = map.shapes.first(where:{ $0.region.id == pendingJump }) {
            self.pendingJump = nil
            viewport.camera.center(longitude:Double(shape.center.x)*0.36-180,latitude:90-Double(shape.center.y)*0.36,zoom:2)
            saveCamera(viewport.camera)
            chooseDirectly(shape.region)
        } else if let current = session.explore.selected {
            let selection = map.shapes.first { $0.region.id == current }?.region
            picked = selection
            coincident = []
            if selection == nil { session.explore.selected = nil; reframe(); session.scheduleSave() }
            else { reframe() }
        }
    }

    private func select(_ regions: [MapRegion]) {
        if regions.isEmpty {
            withAnimation(Design.motion(reduceMotion)) { picked = nil }
            coincident = []
            session.explore.selected = nil
            reframe()
            session.scheduleSave()
        } else if let first = regions.first {
            coincident = regions
            chooseDirectly(first)
        }
    }

    private func chooseDirectly(_ region: MapRegion) {
        let different = picked?.id != region.id
        if picked == nil { session.explore.drawer = .summary }
        session.explore.selected = region.id
        withAnimation(Design.motion(reduceMotion)) { picked = region }
        reframe()
        if different && session.preferences.haptics { GlobeHaptics.selection() }
        session.scheduleSave()
    }

    private func followJump(_ jump: MapJump?) {
        guard let jump else { return }
        session.consumeJump(jump)
        pendingJump = jump.mapID
        if let year = content.atlas.year(for:jump.mapID,near:jump.year ?? session.explore.year) {
            commit(year,feedback:false)
        }
        if let applied, let appliedMap, applied.year == requested, applied.layer == atlasRequest.layer {
            apply(applied,appliedMap)
        }
    }

    private func open(_ binding: AtlasIndex.Binding) {
        session.open(ReadingNode(volume:binding.volume,chapter:binding.chapter,entryYear:applied?.year ?? requested))
    }

    private func reframe() {
        if picked == nil { viewport.camera.verticalCenter = 0.48 }
        else {
            switch session.explore.drawer {
            case .collapsed: viewport.camera.verticalCenter = 0.45
            case .summary: viewport.camera.verticalCenter = 0.40
            case .expanded: viewport.camera.verticalCenter = 0.31
            }
        }
    }

    private func resetView() { viewport.camera = GlobeCamera(); reframe(); saveCamera(viewport.camera) }

    private func saveCamera(_ view: GlobeCamera) {
        var copy = view
        copy.verticalCenter = 0.48
        session.setCamera(copy)
    }

    private func bottomInset(_ height: CGFloat) -> CGFloat {
        guard picked != nil else { return 115 }
        switch session.explore.drawer {
        case .collapsed: return 84
        case .summary: return min(232,height * 0.31) + 12
        case .expanded: return min(height - 112,height * 0.62) + 12
        }
    }
}

private struct RegionDetails: View {
    let region: MapRegion
    let year: Int
    let coincident: [MapRegion]
    let content: AppContent
    let onOpen: (AtlasIndex.Binding) -> Void
    let onSwitch: (MapRegion) -> Void
    let onSources: () -> Void

    var body: some View {
        let bindings = content.index.bindings(region.id,in:year)
        if let summary = region.summary { Text(summary).font(.subheadline) }
        if let note = region.note { Text(note).font(.subheadline).foregroundStyle(Design.quiet) }
        if let main = bindings.first(where:{ $0.relation == "primary" }), let work = content.archive.volume(main.volume) {
            PaperAction(title:work.title,symbol:"book",prominent:true) { onOpen(main) }
                .accessibilityIdentifier("open-region-book")
            if let scope = work.scope ?? main.reason {
                Text(scope).font(.footnote).foregroundStyle(Design.quiet)
            }
        }
        ForEach(bindings.filter { $0.relation == "related" }) { link in
            if let work = content.archive.volume(link.volume) {
                PaperAction(title:work.chapter(link.chapter)?.title ?? work.title,symbol:"book.closed") { onOpen(link) }
                if let scope = link.reason { Text(scope).font(.footnote).foregroundStyle(Design.quiet) }
            }
        }
        if let coverage = region.coverage {
            Text("底图记录覆盖 \(coverage)").font(.footnote).foregroundStyle(Design.quiet)
        }
        let others = coincident.filter { $0.id != region.id }
        if !others.isEmpty {
            Divider()
            Text("此位置的其他地图记录").font(.caption).foregroundStyle(Design.quiet)
            ForEach(others) { candidate in
                PaperAction(title:candidate.name,symbol:"map") { onSwitch(candidate) }
            }
        }
        PaperAction(title:"地图资料",symbol:"info.circle",action:onSources)
    }
}

private struct YearChooser: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var scale: TimelineScale
    @State private var input: String
    @State private var rejected = false
    let apply: (Int) -> Void

    init(initial: Int,scale: Binding<TimelineScale>,apply: @escaping (Int) -> Void) {
        _input = State(initialValue:String(initial))
        _scale = scale
        self.apply = apply
    }

    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:17) {
                HStack {
                    PaperHeader(title:"选择年份")
                    IconAction(icon:"xmark",label:"关闭选年",tint:Design.quiet) { dismiss() }
                }
                TextField("年份",text:$input)
                    .font(.system(.title2,design:.serif)).keyboardType(.numbersAndPunctuation)
                    .textFieldStyle(.roundedBorder).submitLabel(.go).onSubmit(submit)
                    .accessibilityIdentifier("year-input")
                Text(rejected ? "请输入有效年份。纪年中没有 0 年。" : "公元前可输入负数。范围：\(eraYear(Chronology.first)) 至 \(Chronology.latest) 年。")
                    .font(.caption).foregroundStyle(rejected ? Design.vermilion : Design.quiet)
                Picker("时间轴尺度",selection:$scale) {
                    ForEach(TimelineScale.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                PaperAction(title:"前往这一年",symbol:"arrow.right",prominent:true,action:submit)
                    .accessibilityIdentifier("submit-year")
                PaperAction(title:"回到当代",symbol:"clock.arrow.circlepath") { finish(Chronology.latest) }
            }
            .padding(Design.inset)
        }
        .background(Design.paper.ignoresSafeArea()).foregroundStyle(Design.ink)
        .preferredColorScheme(.light)
    }

    private func submit() {
        guard let year = Chronology.parse(input) else { rejected = true; return }
        finish(year)
    }

    private func finish(_ year: Int) { apply(year); dismiss() }
}
