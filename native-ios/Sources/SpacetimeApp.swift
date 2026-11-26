import SwiftUI

@main
struct SpacetimeApp: App {
    var body: some Scene { WindowGroup { Startup() } }
}

private struct Startup: View {
    @State private var model: AppContent?
    @State private var failed = false
    @State private var retry = 0

    var body: some View {
        ZStack {
            Design.space.ignoresSafeArea()
            if let model {
                JourneyRoot(content:model)
            } else if failed {
                VStack(spacing:12) {
                    Text("无法读取离线资料").font(.title3)
                    Button("重试") { retry += 1 }
                }
                .foregroundStyle(.white)
            } else {
                ProgressView("正在打开时空地球").foregroundStyle(.white).tint(Design.gold)
            }
        }
        .task(id:retry) {
            failed = false
            do {
                guard let manifest = Bundle.main.url(forResource:"Manifest",withExtension:"json",subdirectory:"OfflineData") else {
                    throw CocoaError(.fileNoSuchFile)
                }
                let task = Task.detached(priority:.userInitiated) { try AppContent(directory:manifest.deletingLastPathComponent()) }
                let result = try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() }
                try Task.checkCancellation()
                model = result
            } catch is CancellationError {
                return
            } catch {
                NSLog("Offline library: %@",String(describing:error))
                failed = true
            }
        }
    }
}

struct AppContent {
    let history: OfflineHistory
    let atlas: GlobeAtlas
    let map: MapCache
    let search: HistorySearch

    init(directory: URL) throws {
        let history = try OfflineHistory(directory:directory)
        self.history = history
        self.atlas = try (try? GlobeAtlas(index:history.index,polygons:history.polygons))
            ?? GlobeAtlas(index:history.index,polygons:nil)
        self.map = MapCache(atlas)
        self.search = HistorySearch(archive:history.archive,index:history.index)
    }

    var archive: Archive { history.archive }
    var resources: URL { history.resources }
    var index: AtlasIndex { history.index }
}

private struct JourneyRoot: View {
    let content: AppContent
    @StateObject private var session: SessionStore
    @State private var mapStatusUsesPaper = false
    @Environment(\.scenePhase) private var phase

    init(content: AppContent) {
        self.content = content
        _session = StateObject(wrappedValue:SessionStore(archive:content.archive,index:content.index))
    }

    private var colorScheme: ColorScheme {
        if session.observe != nil { return mapStatusUsesPaper ? .light : .dark }
        if session.reading != nil { return session.preferences.paper == .night ? .dark : .light }
        return mapStatusUsesPaper ? .light : .dark
    }

    var body: some View {
        ZStack {
            if let reading = session.reading {
                ReadingView(content:content,session:session,reading:reading)
                    .opacity(session.observe == nil ? 1 : 0)
                    .allowsHitTesting(session.observe == nil)
                    .accessibilityHidden(session.observe != nil)
            } else if session.observe == nil {
                ExplorerView(content:content,session:session)
            }
            if let observation = session.observe {
                ObservationView(content:content,session:session,observation:observation)
                    .transition(.opacity)
            }
        }
        .environment(\.mapStatusBar) { mapStatusUsesPaper = $0 }
        .preferredColorScheme(colorScheme)
        .sheet(item:$session.panel) { panel in
            CompanionView(content:content,session:session,kind:panel)
        }
        .onChange(of:session.panel) { _ in session.scheduleSave() }
        .onChange(of:session.preferences) { _ in session.scheduleSave() }
        .onChange(of:session.shelf) { _ in session.scheduleSave() }
        .onChange(of:phase) { phase in if phase != .active { session.save() } }
    }
}

private struct MapStatusBarKey: EnvironmentKey {
    static let defaultValue: (Bool) -> Void = { _ in }
}

extension EnvironmentValues {
    var mapStatusBar: (Bool) -> Void {
        get { self[MapStatusBarKey.self] }
        set { self[MapStatusBarKey.self] = newValue }
    }
}
