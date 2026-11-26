import SwiftUI
import UIKit

@main
struct SpacetimeApp: App {
    var body: some Scene { WindowGroup { StartupView() } }
}

private struct StartupView: View {
    @State private var history: OfflineHistory?
    @State private var atlas: GlobeAtlas?
    @State private var error: String?

    var body: some View {
        Group {
            if let history, let atlas {
                Explorer(history: history, atlas: atlas)
            } else if let error {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                    Text("离线资料无法打开").font(.headline)
                    Text(error).font(.footnote)
                    Button("重试") { Task { await load() } }
                }
                .padding()
            } else {
                ProgressView("正在读取随附的历史资料")
            }
        }
        .preferredColorScheme(.dark)
        .task { await load() }
    }

    private func load() async {
        error = nil
        do {
            guard let resources = Bundle.main.resourceURL?.appendingPathComponent("Resources") else {
                throw CocoaError(.fileNoSuchFile)
            }
            let result = try await Task.detached(priority: .userInitiated) {
                let history = try OfflineHistory(directory: resources)
                return (history, try GlobeAtlas(index: history.index, polygons: history.polygons))
            }.value
            history = result.0
            atlas = result.1
        } catch {
            self.error = String(describing: error)
        }
    }
}

private struct Explorer: View {
    let history: OfflineHistory
    let atlas: GlobeAtlas
    @AppStorage("exploreYear") private var year = 1500
    @AppStorage("mapLayer") private var layer: GlobeLayer = .timeline
    @AppStorage("showMapNames") private var showNames = true
    @AppStorage("selectionHaptics") private var haptics = true
    @AppStorage("exploreCamera") private var storedCamera = Data()
    @AppStorage("lastReadingVolume") private var lastVolume = ""
    @AppStorage("lastReadingChapter") private var lastChapter = ""
    @State private var camera = GlobeCamera()
    @State private var region: MapRegion?
    @State private var reading: ReadingLaunch?
    @State private var showingCalendar = false
    @State private var showingSources = false
    @State private var previewYear: Int?
    @State private var draggedFrom: Int?
    @State private var lastTick = Date.distantPast
    @State private var restoredCamera = false

    private let firstYear = -3500
    private var lastYear: Int { Calendar(identifier: .gregorian).component(.year, from: Date()) }

    var body: some View {
        ZStack {
            NativeGlobe(atlas: atlas, resources: history.resources,
                        request: AtlasRequest(layer: layer, year: year, selected: region?.id),
                        camera: $camera, showNames: showNames, onZoomLimit: {
                if haptics { GlobeHaptics.boundary() }
            }, onRegion: selectRegion)
                .ignoresSafeArea()
            VStack(spacing: 8) {
                header
                Spacer(minLength: 12)
                if let region {
                    regionCard(region)
                } else {
                    timelinePanel
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .background(Color(red: 0.044, green: 0.063, blue: 0.085).ignoresSafeArea())
        .onAppear {
            guard !restoredCamera else { return }
            if let saved = try? JSONDecoder().decode(GlobeCamera.self, from: storedCamera) { camera = saved }
            restoredCamera = true
        }
        .task(id: camera) {
            guard restoredCamera else { return }
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled, let encoded = try? JSONEncoder().encode(camera) else { return }
            storedCamera = encoded
        }
        .sheet(isPresented: $showingCalendar) {
            YearEditor(year: year, range: firstYear...lastYear) { setYear($0) }
                .presentationDetents([.medium])
        }
        .sheet(isPresented: $showingSources) {
            NavigationStack {
                List(history.index.mapSources.keys.sorted(), id: \.self) { key in
                    if let source = history.index.mapSources[key] {
                        VStack(alignment: .leading, spacing: 6) {
                            Link(source.name, destination: source.source)
                            if let license = source.license { Text(license).font(.caption) }
                            if let limits = source.limitations { Text(limits).font(.footnote) }
                        }
                    }
                }
                .navigationTitle("地图来源")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { showingSources = false } } }
            }
        }
        .fullScreenCover(item: $reading) { launch in
            ReadingFlow(history: history, atlas: atlas, launch: launch)
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            Button {
                showingCalendar = true
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 7) {
                        Text(eraYear(previewYear ?? year)).font(.system(size: 32, weight: .medium, design: .serif))
                            .monospacedDigit()
                        Image(systemName: "chevron.down").font(.caption)
                    }
                    Text(layerHeading).font(.caption).foregroundStyle(.secondary)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 13).padding(.vertical, 8)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 17))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("选择年份，\(eraYear(year)) 年")
            Spacer()
            Menu {
                Picker("地图图层", selection: $layer) {
                    ForEach(GlobeLayer.allCases) { Text($0.label).tag($0) }
                }
                Toggle("显示地名", isOn: $showNames)
                Toggle("触感反馈", isOn: $haptics)
                Button { camera = GlobeCamera() } label: { Label("重置地球视角", systemImage: "globe") }
                Button { showingSources = true } label: { Label("地图来源", systemImage: "info.circle") }
            } label: {
                Image(systemName: "square.3.layers.3d")
                    .font(.system(size: 20)).frame(width: 48, height: 48)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel("地球设置")
            .onChange(of: layer) { _ in region = nil }
        }
    }

    private var layerHeading: String {
        if layer != .timeline { return layer.label }
        if year > atlas.index.coverage.to { return "现代参考边界" }
        if year < atlas.index.coverage.from { return "早于疆域底图覆盖" }
        return "历史疆域"
    }

    private var timelinePanel: some View {
        VStack(spacing: 4) {
            HStack(spacing: 12) {
                Button { reading = ReadingLaunch(root: .events(year)) } label: {
                    Label("\(eraYear(year)) 年事件", systemImage: "clock")
                }
                Spacer(minLength: 4)
                Button { reading = ReadingLaunch(root: .library) } label: {
                    Label("书架", systemImage: "books.vertical")
                }
                if !lastVolume.isEmpty, !lastChapter.isEmpty {
                    Button {
                        reading = ReadingLaunch(root: .library, path: [.volume(lastVolume), .chapter(lastVolume, lastChapter)])
                    } label: {
                        Image(systemName: "bookmark.fill").frame(minWidth: 26, minHeight: 30)
                    }
                    .accessibilityLabel("继续阅读")
                }
            }
            .font(.subheadline.weight(.semibold))
            HStack(spacing: 7) {
                nudgeButton(-1)
                GeometryReader { proxy in
                    Canvas { context, size in
                        let middle = size.width / 2
                        for tick in -10...10 {
                            let x = middle + Double(tick) * size.width / 21
                            let height: Double = tick == 0 ? 27 : (tick.isMultiple(of: 5) ? 17 : 9)
                            var line = Path()
                            line.move(to: CGPoint(x: x, y: size.height - height))
                            line.addLine(to: CGPoint(x: x, y: size.height - 5))
                            context.stroke(line, with: .color(tick == 0 ? .orange : .white.opacity(0.52)), lineWidth: tick == 0 ? 2 : 1)
                        }
                    }
                    .contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                        if draggedFrom == nil {
                            draggedFrom = year
                            if haptics { GlobeHaptics.prepareSelection() }
                        }
                        let next = offsetYear(from: draggedFrom ?? year,
                                              by: Int((-value.translation.width / max(8, proxy.size.width / 50)).rounded()) * 5)
                        if next != (previewYear ?? year), haptics, Date().timeIntervalSince(lastTick) >= 0.065 {
                            GlobeHaptics.selection()
                            lastTick = Date()
                        }
                        previewYear = next
                    }.onEnded { _ in
                        if let previewYear { setYear(previewYear, feedback: false) }
                        previewYear = nil
                        draggedFrom = nil
                    })
                    .accessibilityElement()
                    .accessibilityLabel("时间轴")
                    .accessibilityValue("\(eraYear(year)) 年")
                    .accessibilityAdjustableAction {
                        switch $0 {
                        case .increment: setYear(offsetYear(from: year, by: 5))
                        case .decrement: setYear(offsetYear(from: year, by: -5))
                        @unknown default: break
                        }
                    }
                }
                .frame(height: 40)
                nudgeButton(1)
            }
        }
        .padding(.horizontal, 13).padding(.vertical, 10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22))
        .foregroundStyle(Color.white)
    }

    private func nudgeButton(_ delta: Int) -> some View {
        Button { setYear(offsetYear(from: year, by: delta)) } label: {
            Image(systemName: delta < 0 ? "chevron.left" : "chevron.right")
                .frame(width: 42, height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(delta < 0 ? "上一年" : "下一年")
    }

    private func offsetYear(from year: Int, by delta: Int) -> Int {
        let serial = (year > 0 ? year - 1 : year) + delta
        return (serial >= 0 ? serial + 1 : serial).clamped(to: firstYear...lastYear)
    }

    private func regionCard(_ region: MapRegion) -> some View {
        let books = atlas.index.bindings(region.id, in: year)
        let primary = books.first.flatMap { history.archive.volume($0.volume) }
        return VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(region.name).font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
                    Text(region.dates).font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer(minLength: 10)
                Button { self.region = nil } label: {
                    Image(systemName: "xmark").font(.body).frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("关闭疆域摘要")
            }
            if let description = primary?.summary ?? region.note {
                Text(description).font(.subheadline).lineLimit(3)
            }
            ForEach(books.prefix(3)) { binding in
                if let book = history.archive.volume(binding.volume) {
                    Button {
                        let chapter = binding.chapter ?? book.recommendation(in: year)?.id
                        var path: [ReaderDestination] = [.volume(book.id)]
                        if let chapter { path.append(.chapter(book.id, chapter)) }
                        reading = ReadingLaunch(root: .library, path: path)
                    } label: {
                        Label(book.title, systemImage: "book").frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.borderedProminent).tint(.brown)
                }
            }
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22))
    }

    private func selectRegion(_ selected: MapRegion?) {
        guard region?.id != selected?.id else { return }
        region = selected
        if selected != nil && haptics { GlobeHaptics.selection() }
    }

    private func setYear(_ newYear: Int, feedback: Bool = true) {
        guard newYear != year, newYear != 0, (firstYear...lastYear).contains(newYear) else { return }
        year = newYear
        region = nil
        if feedback && haptics { GlobeHaptics.selection() }
    }
}

private struct YearEditor: View {
    @Environment(\.dismiss) private var dismiss
    @FocusState private var isFocused: Bool
    let range: ClosedRange<Int>
    let onSelection: (Int) -> Void
    @State private var input: String
    @State private var invalid = false

    init(year: Int, range: ClosedRange<Int>, onSelection: @escaping (Int) -> Void) {
        self.range = range
        self.onSelection = onSelection
        _input = State(initialValue: String(year))
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("年份", text: $input).focused($isFocused).submitLabel(.go)
                    .keyboardType(.numbersAndPunctuation).onSubmit(submit)
                Text(invalid ? "请输入有效年份。公元纪年没有 0 年。" :
                     "范围为\(eraYear(range.lowerBound))年至\(range.upperBound)年。公元前一年可输入 −1。")
                    .font(.footnote).foregroundStyle(invalid ? Color.orange : Color.secondary)
            }
            .navigationTitle("选择年份")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("前往", action: submit) }
            }
        }
        .onAppear { isFocused = true }
    }

    private func submit() {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "公元前", with: "-")
            .replacingOccurrences(of: "前", with: "-")
            .replacingOccurrences(of: "−", with: "-")
            .replacingOccurrences(of: "年", with: "")
        guard let number = Int(value), number != 0, range.contains(number) else { invalid = true; return }
        onSelection(number)
        dismiss()
    }
}
