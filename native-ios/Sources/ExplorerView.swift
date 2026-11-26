import SwiftUI
import UIKit

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
    @State private var scaleMenuVisible = false
    @State private var panelDismissal = 0
    @State private var pendingJump: String?

    init(content: AppContent,session: SessionStore) {
        self.content = content
        self.session = session
        _viewport = StateObject(wrappedValue:GlobeViewport(session.explore.camera))
        _requested = State(initialValue:session.explore.year)
    }

    var body: some View {
        let sites = atlasRequest.layer == .timeline ? content.archive.sites(in:requested) : []
        ZStack(alignment:.top) {
            NativeGlobe(cache:content.map,resources:content.resources,request:atlasRequest,viewport:viewport,
                        showNames:session.preferences.showNames,selected:picked?.id,
                        marks:GlobeMarks(explorationSites:sites),
                        haptics:session.preferences.haptics,allowsIdleRotation:allowsIdleRotation,
                        idleRotationSpeed:session.preferences.idleRotationSpeed,
                        onApplied:apply,onRegions:select,
                        onPlace:{ id in
                            guard let site = sites.first(where:{ $0.id == id }) else { return }
                            if session.preferences.haptics { GlobeHaptics.selection() }
                            session.startObservation(.scene(site.scene),stage:site.stage,place:site.place.id)
                        },
                        onSettled:saveCamera)
                .ignoresSafeArea()
            VStack(spacing:0) {
                header.mapChrome(top:true,viewport:viewport)
                Spacer(minLength:0)
                if picked == nil { footer.mapChrome(top:false,viewport:viewport) }
            }
            .accessibilityHidden(picked != nil && session.explore.drawer == .full)
            if let picked {
                MapPanel(position:session.explore.drawer,viewport:viewport,canDismiss:true,dismissal:panelDismissal,
                         onPosition:{ session.explore.drawer = $0 }, onDismiss:{ select([]) },
                         compact:{ regionSummary(picked) }, full:{ regionFull(picked) })
                    .ignoresSafeArea()
            }
        }
        .environment(\.colorScheme,.dark)
        .background(Design.space.ignoresSafeArea())
        .sheet(isPresented:$yearEditor) {
            YearChooser(initial:session.explore.year) { year in
                commit(year,feedback:true)
            }
            .presentationDetents([.height(306),.medium])
            .presentationDragIndicator(.visible)
        }
        .task(id:preview) {
            guard let preview, preview != requested else { return }
            do { try await Task.sleep(nanoseconds:62_000_000); requested = preview } catch { return }
        }
        .onAppear { followJump(session.jump) }
        .onChange(of:session.jump) { followJump($0) }
        .onChange(of:session.explore.drawer) { _ in session.scheduleSave() }
        .onChange(of:session.explore.layer) { _ in
            picked = nil
            coincident = []
            session.explore.selected = nil
            session.scheduleSave()
        }
        .onChange(of:session.explore.scale) { _ in session.scheduleSave() }
        .onDisappear { saveCamera(viewport.camera) }
    }

    private var allowsIdleRotation: Bool {
        session.preferences.idleRotation && session.explore.selected == nil && picked == nil &&
            !yearEditor && !scaleMenuVisible && session.panel == nil &&
            preview == nil && pendingJump == nil && applied == atlasRequest
    }

    private var atlasRequest: AtlasKey {
        let layer = content.atlas.hasHistory || session.explore.layer != .timeline ? session.explore.layer : .terrain
        return AtlasKey(layer:layer,year:requested)
    }

    private var header: some View {
        HStack(alignment:.top,spacing:4) {
            Button { openYearOverview() } label: {
                VStack(alignment:.leading,spacing:2) {
                    HStack(alignment:.firstTextBaseline,spacing:7) {
                        Text(eraYear(preview ?? session.explore.year))
                            .font(.system(.largeTitle,design:.serif,weight:.semibold))
                            .monospacedDigit().lineLimit(1).minimumScaleFactor(0.65)
                        Image(systemName:"chevron.right").font(.caption.weight(.semibold))
                    }
                    Text(mapCaption).font(.caption).foregroundStyle(.white.opacity(0.67))
                        .fixedSize(horizontal:false,vertical:true)
                }
                .frame(minHeight:44,alignment:.leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("这一年的世界")
            .accessibilityValue(eraYear(preview ?? session.explore.year) + " 年")
            .accessibilityHint("打开当前年份的史事和相关资料。")
            .accessibilityIdentifier("open-almanac")
            Spacer(minLength:0)
            ExplorerOptionsButton(menu:optionsMenu,viewport:viewport)
                .frame(width:44,height:44)
        }
        .foregroundStyle(.white)
        .padding(.horizontal,Design.inset)
        .padding(.top,5)
    }

    private var optionsMenu: UIMenu {
        var actions: [UIMenuElement] = [
            option("历史书目",symbol:"books.vertical") { session.panel = .library }
        ]
        if let recent = session.lastRead {
            actions.append(option("继续阅读",symbol:"bookmark") {
                session.open(ReadingNode(volume:recent.volume,chapter:recent.chapter))
            })
        }
        let layers = GlobeLayer.allCases.map { layer in
            option(layer.label,state:session.explore.layer == layer ? .on : .off) {
                session.explore.layer = layer
            }
        }
        actions.append(UIMenu(title:"地图图层",options:.singleSelection,children:layers))
        actions.append(option("显示地名",state:session.preferences.showNames ? .on : .off) {
            session.preferences.showNames.toggle()
        })
        actions.append(option("复位视角",symbol:"globe",action:resetView))
        actions.append(option("设置与关于",symbol:"gearshape") { session.panel = .options })
        return UIMenu(children:actions)
    }

    private func option(_ title: String, symbol: String? = nil, state: UIMenuElement.State = .off,
                        action: @escaping () -> Void) -> UIAction {
        UIAction(title:title,image:symbol.flatMap { UIImage(systemName:$0) },state:state) { _ in
            viewport.setIdleBlock(.menu,active:false)
            action()
        }
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
        VStack(spacing:0) {
            HistoryTimeline(year:session.explore.year,scale:session.explore.scale,
                            eventIndices:content.archive.eventStartIndices,
                            haptics:session.preferences.haptics,reduceMotion:reduceMotion,
                            active:!yearEditor && !scaleMenuVisible && session.panel == nil,
                            allowsTouch:{ viewport.permitsTimelineTouch },
                            onTracking:{ viewport.setIdleBlock(.timeline,active:$0) },
                            onPreview:{ preview = $0 },
                            onCancel:{ preview = nil; requested = session.explore.year },
                            onCommit:{ commit($0,feedback:false) },
                            onScale:{ session.explore.scale = $0 },onChooseYear:{ yearEditor = true })
                .frame(height:53)
            ExplorerOptionsButton(menu:scaleMenu,viewport:viewport,title:session.explore.scale.label,
                                  identifier:"timeline-scale",accessibilityName:"时间轴尺度和精确选年",
                                  onVisibility:{ visible in
                                      if visible, let preview { commit(preview,feedback:false) }
                                      scaleMenuVisible = visible
                                  })
                .frame(width:126,height:32)
        }
        .padding(.horizontal,15)
    }

    private var scaleMenu: UIMenu {
        let scales = TimelineScale.allCases.map { scale in
            option(scale.label,state:session.explore.scale == scale ? .on : .off) {
                session.explore.scale = scale
                scaleMenuVisible = false
            }
        }
        return UIMenu(children:[
            UIMenu(title:"时间轴尺度",options:[.displayInline,.singleSelection],children:scales),
            option("精确选年",symbol:"calendar") { scaleMenuVisible = false; yearEditor = true }
        ])
    }

    private func openYearOverview() {
        let year = preview ?? session.explore.year
        commit(year,feedback:false)
        session.panel = .year(year)
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
        let changed = applied?.year != key.year || applied?.layer != key.layer
        applied = key
        appliedMap = map
        if let pendingJump, let shape = map.shapes.first(where:{ $0.region.id == pendingJump }) {
            self.pendingJump = nil
            var target = viewport.camera
            target.center(longitude:Double(shape.center.x)*0.36-180,latitude:90-Double(shape.center.y)*0.36,zoom:2)
            viewport.move(to:target)
            chooseDirectly(shape.region)
        } else if let current = session.explore.selected {
            let selection = map.shapes.first { $0.region.id == current }?.region
            picked = selection
            if changed { coincident = [] }
            if selection == nil { session.explore.selected = nil; session.scheduleSave() }
        }
    }

    private func select(_ regions: [MapRegion]) {
        if regions.isEmpty {
            picked = nil
            coincident = []
            session.explore.selected = nil
            session.scheduleSave()
        } else if let first = regions.first {
            coincident = regions
            chooseDirectly(first)
        }
    }

    private func chooseDirectly(_ region: MapRegion) {
        let different = picked?.id != region.id
        if different { session.explore.drawer = .compact }
        session.explore.selected = region.id
        picked = region
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

    private func resetView() { viewport.move(to:GlobeCamera()) }

    private func saveCamera(_ view: GlobeCamera) {
        session.setCamera(view)
    }

    private func regionSummary(_ region: MapRegion) -> some View {
        let year = applied?.year ?? requested
        let volume = content.index.bindings(region.id,in:year).first { $0.relation == "primary" }
        return VStack(alignment:.leading,spacing:8) {
            SheetHandle()
            HStack(spacing:8) {
                VStack(alignment:.leading,spacing:2) {
                    Text(region.name).font(.system(.title3,design:.serif,weight:.semibold)).lineLimit(2)
                    Text(region.dates).font(.caption).foregroundStyle(Design.quiet).lineLimit(1)
                }
                Spacer(minLength:4)
                IconAction(icon:"chevron.up",label:"展开主体详情",tint:Design.quiet) {
                    session.explore.drawer = .full
                }
                .accessibilityIdentifier("expand-region")
                closeRegion
            }
            if let volume, let work = content.archive.volume(volume.volume) {
                PaperAction(title:work.title,symbol:"book",prominent:true) { open(volume) }
                    .accessibilityIdentifier("open-region-book")
            } else if let summary = region.summary {
                Text(summary).font(.subheadline).lineLimit(2)
            }
        }
        .padding(.horizontal,Design.inset).padding(.bottom,10)
        .foregroundStyle(Design.ink)
    }

    private func regionFull(_ region: MapRegion) -> some View {
        VStack(alignment:.leading,spacing:17) {
            SheetHandle()
            HStack(spacing:8) {
                VStack(alignment:.leading,spacing:5) {
                    Text(region.name).font(.system(.largeTitle,design:.serif,weight:.semibold))
                    Text(region.dates).font(.subheadline).foregroundStyle(Design.quiet)
                }
                Spacer(minLength:4)
                IconAction(icon:"chevron.down",label:"返回主体摘要",tint:Design.quiet) {
                    session.explore.drawer = .compact
                }
                .accessibilityIdentifier("compact-region")
                closeRegion
            }
            Divider()
            RegionDetails(region:region,year:applied?.year ?? requested,coincident:coincident,content:content,
                          onOpen:open,onSwitch:chooseDirectly,onSources:{ session.panel = .sources })
        }
        .frame(maxWidth:.infinity,alignment:.leading)
        .padding(.horizontal,Design.inset).padding(.bottom,24)
        .foregroundStyle(Design.ink)
    }

    private var closeRegion: some View {
        IconAction(icon:"xmark",label:"关闭主体详情",tint:Design.quiet) { panelDismissal += 1 }
            .accessibilityIdentifier("close-region")
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
    private enum Era: String, CaseIterable {
        case before = "公元前"
        case after = "公元后"
    }

    @Environment(\.dismiss) private var dismiss
    @State private var era: Era
    @State private var input: String
    @State private var rejected = false
    let apply: (Int) -> Void

    init(initial: Int,apply: @escaping (Int) -> Void) {
        _era = State(initialValue:initial < 0 ? .before : .after)
        _input = State(initialValue:String(abs(initial)))
        self.apply = apply
    }

    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:9) {
                HStack {
                    PaperHeader(title:"精确选年")
                    IconAction(icon:"xmark",label:"关闭选年",tint:Design.quiet) { dismiss() }
                }
                Picker("纪年",selection:$era) {
                    ForEach(Era.allCases,id:\.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                YearInputField(text:$input)
                    .frame(height:44)
                Text(rejected ? "请输入范围内的年份，纪年中没有 0 年。"
                              : "公元前 \(abs(Chronology.first)) 年至公元后 \(Chronology.latest) 年")
                    .font(.footnote).foregroundStyle(rejected ? Design.vermilion : Design.quiet)
                PaperAction(title:"前往指定年份",symbol:"arrow.right",prominent:true,action:submit)
                    .accessibilityIdentifier("submit-year")
                PaperAction(title:"回到当代",symbol:"clock.arrow.circlepath") { finish(Chronology.latest) }
            }
            .padding(.horizontal,Design.inset).padding(.vertical,12)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Design.paper.ignoresSafeArea())
        .foregroundStyle(Design.ink)
        .preferredColorScheme(.light)
        .onChange(of:input) { _ in rejected = false }
        .onChange(of:era) { _ in rejected = false }
    }

    private func submit() {
        guard let year = Chronology.numericYear(input,beforeCommonEra:era == .before) else {
            rejected = true
            return
        }
        finish(year)
    }

    private func finish(_ year: Int) { apply(year); dismiss() }
}

private struct YearInputField: UIViewRepresentable {
    @Binding var text: String

    func makeCoordinator() -> Coordinator { Coordinator(text:$text) }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.borderStyle = .roundedRect
        field.font = .preferredFont(forTextStyle:.title2)
        field.adjustsFontForContentSizeCategory = true
        field.keyboardType = .numberPad
        field.accessibilityLabel = "年份数字"
        field.accessibilityIdentifier = "year-input"
        field.delegate = context.coordinator
        field.addTarget(context.coordinator,action:#selector(Coordinator.edited(_:)),for:.editingChanged)
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.text = $text
        if field.text != text { field.text = text }
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var text: Binding<String>
        init(text: Binding<String>) { self.text = text }

        func textFieldDidBeginEditing(_ field: UITextField) {
            DispatchQueue.main.async { [weak field] in field?.selectAll(nil) }
        }

        @objc func edited(_ field: UITextField) {
            let digits = (field.text ?? "").compactMap(\.wholeNumberValue).filter { $0 < 10 }
            let normalized = digits.map(String.init).joined()
            if field.text != normalized { field.text = normalized }
            text.wrappedValue = normalized
        }
    }
}

private struct ExplorerOptionsButton: UIViewRepresentable {
    let menu: UIMenu
    let viewport: GlobeViewport
    var title: String?
    var identifier = "explore-options"
    var accessibilityName = "探索选项"
    var onVisibility: (Bool) -> Void = { _ in }

    func makeUIView(context: Context) -> Button {
        let button = Button(type:.system)
        button.tintColor = .white
        if title == nil {
            button.setImage(UIImage(systemName:"ellipsis",withConfiguration:UIImage.SymbolConfiguration(pointSize:22,weight:.semibold)),
                            for:.normal)
        } else {
            button.titleLabel?.font = .monospacedDigitSystemFont(ofSize:12,weight:.medium)
            button.setTitleColor(UIColor(Design.gold),for:.normal)
        }
        button.showsMenuAsPrimaryAction = true
        button.accessibilityLabel = accessibilityName
        button.accessibilityIdentifier = identifier
        return button
    }

    func updateUIView(_ button: Button, context: Context) {
        button.viewport = viewport
        button.onVisibility = onVisibility
        button.menu = menu
        if let title {
            button.setTitle(title,for:.normal)
            button.accessibilityValue = title
        }
    }

    static func dismantleUIView(_ button: Button, coordinator: ()) {
        button.viewport?.setIdleBlock(.menu,active:false)
    }

    final class Button: UIButton {
        weak var viewport: GlobeViewport?
        var onVisibility: (Bool) -> Void = { _ in }

        override func contextMenuInteraction(_ interaction: UIContextMenuInteraction,
                                             willDisplayMenuFor configuration: UIContextMenuConfiguration,
                                             animator: (any UIContextMenuInteractionAnimating)?) {
            super.contextMenuInteraction(interaction,willDisplayMenuFor:configuration,animator:animator)
            viewport?.setIdleBlock(.menu,active:true)
            onVisibility(true)
        }

        override func contextMenuInteraction(_ interaction: UIContextMenuInteraction,
                                             willEndFor configuration: UIContextMenuConfiguration,
                                             animator: (any UIContextMenuInteractionAnimating)?) {
            super.contextMenuInteraction(interaction,willEndFor:configuration,animator:animator)
            viewport?.setIdleBlock(.menu,active:false)
            onVisibility(false)
        }
    }
}
