import SwiftUI
import UIKit

struct NativeGlobe: View {
    let cache: MapCache
    let resources: URL
    let request: AtlasKey
    let viewport: GlobeViewport
    var showNames = true
    var selected: String?
    var marks = GlobeMarks()
    var sceneKey: String?
    var showPendingArt = true
    var haptics = true
    var allowsIdleRotation = false
    var onApplied: (AtlasKey, PaintedAtlas) -> Void = { _,_ in }
    var onRegions: ([MapRegion]) -> Void = { _ in }
    var onPlace: (String) -> Void = { _ in }
    var onSettled: (GlobeCamera) -> Void = { _ in }

    @Environment(\.scenePhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var displayed: Displayed?
    @State private var assets: GlobeGPUAssets?
    @State private var loadError = false
    @State private var retry = 0

    private struct Displayed {
        let request: AtlasKey
        let atlas: PaintedAtlas
        let gpu: GPUAtlas
    }

    private struct Load: Hashable {
        let request: AtlasKey
        let retry: Int
        let active: Bool
    }

    private var load: Load { Load(request:request,retry:retry,active:phase == .active) }
    private var isCurrent: Bool { displayed?.request == request }

    var body: some View {
        let art = isCurrent || showPendingArt ? displayed : nil
        ZStack {
            Design.space
            GlobeMetalView(configuration:GlobeSurface.Configuration(
                viewport:viewport,assets:assets,data:art?.atlas,gpu:art?.gpu,
                marks:isCurrent ? marks : GlobeMarks(),sceneKey:isCurrent ? sceneKey : nil,
                selected:isCurrent ? selected : nil,showNames:showNames && isCurrent,active:phase == .active,
                reduced:reduceMotion,interactive:isCurrent,allowsIdleRotation:allowsIdleRotation,
                boundaryFeedback:{ if haptics { GlobeHaptics.boundary() } },
                settled:onSettled,regions:onRegions,place:onPlace
            ))
            if loadError {
                Button {
                    loadError = false
                    retry += 1
                } label: {
                    Label(assets == nil ? "重试地球渲染" : "重试疆域资料",systemImage:"arrow.clockwise")
                        .font(.footnote.weight(.semibold)).padding(12)
                        .background(Design.space,in:Capsule())
                }
                .foregroundStyle(Design.gold)
                .accessibilityIdentifier("retry-map")
            }
        }
        .task(id:load) {
            let pending = load
            guard pending.active else { return }
            do {
                let gpu = try await GlobeGPUAssets.load(resources)
                try Task.checkCancellation()
                assets = gpu
                if displayed?.request == pending.request { return }
                if displayed != nil { try await Task.sleep(nanoseconds:34_000_000) }
                let atlas = try await cache.load(pending.request)
                let uploaded = try await gpu.atlases.load(atlas)
                try Task.checkCancellation()
                displayed = Displayed(request:pending.request,atlas:atlas,gpu:uploaded)
                loadError = false
                onApplied(pending.request,atlas)
            } catch is CancellationError {
                return
            } catch {
                NSLog("Globe resource load: %@",String(describing:error))
                loadError = true
            }
        }
    }
}

private struct GlobeMetalView: UIViewRepresentable {
    let configuration: GlobeSurface.Configuration

    func makeUIView(context: Context) -> GlobeSurface { GlobeSurface(frame:.zero) }
    func updateUIView(_ view: GlobeSurface, context: Context) { view.configure(configuration) }
    static func dismantleUIView(_ view: GlobeSurface, coordinator: ()) { view.detach() }
}
