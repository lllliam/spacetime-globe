import SwiftUI

struct GlobeMarks {
    var places: [ScenePlace] = []
    var routes: [SceneRoute] = []
    var focusPolities: [String] = []
    var selectedPlace: String?
}

struct NativeGlobe: View {
    let cache: MapCache
    let resources: URL
    let request: AtlasKey
    @ObservedObject var viewport: GlobeViewport
    var showNames = true
    var selected: String?
    var marks = GlobeMarks()
    var protectedTop: CGFloat = 92
    var protectedBottom: CGFloat = 110
    var showPendingArt = true
    var haptics = true
    var onApplied: (AtlasKey, PaintedAtlas) -> Void = { _,_ in }
    var onRegions: ([MapRegion]) -> Void = { _ in }
    var onPlace: (String) -> Void = { _ in }
    var onSettled: (GlobeCamera) -> Void = { _ in }

    @Environment(\.scenePhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var delivered: AtlasKey?
    @State private var layer: PaintedAtlas?
    @State private var highResolution = false
    @State private var loadError = false
    @State private var rendererError = false
    @State private var retry = 0

    private struct Load: Hashable {
        let request: AtlasKey
        let retry: Int
        let active: Bool
    }
    private var isCurrent: Bool {
        delivered?.geometryYear == request.geometryYear && delivered?.layer == request.layer
    }
    private var load: Load {
        Load(request:AtlasKey(layer:request.layer, year:request.year, detail:highResolution),retry:retry,active:phase == .active)
    }

    var body: some View {
        ZStack {
            Design.space
            if rendererError {
                GeometryReader { geometry in
                    if let url = UIImage(contentsOfFile:resources.appendingPathComponent("earth-detail.jpg").path) {
                        Image(uiImage:url).resizable().scaledToFill()
                            .frame(width:geometry.size.width * 1.8, height:geometry.size.width)
                            .clipped().clipShape(Circle()).frame(maxWidth:.infinity,maxHeight:.infinity)
                            .opacity(0.35).accessibilityHidden(true)
                    }
                }
            } else {
                MetalSurface(resources:resources, camera:$viewport.camera,
                             image:isCurrent || showPendingArt ? layer?.image : nil,
                             active:phase == .active, reduceMotion:reduceMotion,
                             onError:{ rendererError = true },
                             onBoundary:{ if haptics { GlobeHaptics.boundary() } },
                             onSettled:settled, onTap:tap)
                    .id(retry)
            }
            GlobeArtwork(camera:viewport.camera, shapes:isCurrent || showPendingArt ? layer?.shapes ?? [] : [],
                         selected:isCurrent ? selected : nil, marks:isCurrent ? marks : GlobeMarks(),
                         top:protectedTop, bottom:protectedBottom, showNames:showNames && !rendererError)
                .allowsHitTesting(false).accessibilityHidden(true)

            if loadError || rendererError {
                Button {
                    rendererError = false
                    loadError = false
                    retry += 1
                } label: {
                    Label(rendererError ? "重试地球渲染" : "重试疆域资料", systemImage:"arrow.clockwise")
                        .font(.footnote.weight(.semibold)).padding(12)
                        .background(Design.space.opacity(0.92),in:Capsule())
                }
                .foregroundStyle(Design.gold)
                .accessibilityIdentifier("retry-map")
            }
        }
        .task(id:load) {
            let current = load
            guard current.active else { return }
            do {
                if layer != nil { try await Task.sleep(nanoseconds: current.request.detail ? 85_000_000 : 45_000_000) }
                let value = try await cache.load(current.request)
                try Task.checkCancellation()
                layer = value
                delivered = current.request
                loadError = false
                onApplied(current.request,value)
            } catch is CancellationError {
                return
            } catch {
                layer = nil
                delivered = nil
                loadError = true
            }
        }
        .onAppear { highResolution = viewport.camera.zoom > 2.8 }
    }

    private func settled(_ value: GlobeCamera) {
        highResolution = value.zoom > 2.8
        onSettled(value)
    }

    private func tap(_ location: CGPoint, _ size: CGSize) {
        guard isCurrent, let layer else { return }
        let nearest = marks.places.compactMap { place -> (String,CGFloat)? in
            guard let point = viewport.camera.project(longitude:place.lon,latitude:place.lat,size:size) else { return nil }
            return (place.id,hypot(point.x - location.x,point.y - location.y))
        }.filter { $0.1 < 24 }.min { $0.1 < $1.1 }
        if let nearest { onPlace(nearest.0); return }
        guard let point = viewport.camera.unproject(location,size:size) else { onRegions([]); return }
        onRegions(layer.picks(at:point))
    }
}

private struct GlobeArtwork: View {
    let camera: GlobeCamera
    let shapes: [RegionShape]
    let selected: String?
    let marks: GlobeMarks
    let top: CGFloat
    let bottom: CGFloat
    let showNames: Bool

    var body: some View {
        Canvas { context, size in
            let bounds = CGRect(x:8,y:top,width:max(0,size.width - 16),height:max(0,size.height - top - bottom))
            let focus = Set(marks.focusPolities.map { $0.hasPrefix("polity:") ? $0 : "polity:" + $0 })
            for shape in shapes where selected == shape.region.id || focus.contains(shape.region.id) {
                let strength: CGFloat = selected == shape.region.id ? 1.8 : 1.2
                for ring in shape.rings {
                    let projected = ring.map { camera.project($0,size:size) }
                    if projected.count > 2 && projected.allSatisfy({ $0 != nil }) {
                        let line = Path { path in
                            path.addLines(projected.compactMap { $0 })
                            path.closeSubpath()
                        }
                        context.fill(line,with:.color(Design.gold.opacity(0.08)))
                        context.stroke(line,with:.color(Design.gold.opacity(0.95)),lineWidth:strength)
                    } else {
                        let line = projectedLine(projected + [projected.first ?? nil])
                        context.stroke(line,with:.color(Design.gold),lineWidth:strength)
                    }
                }
            }
            for route in marks.routes { draw(route,context:context,size:size) }

            var occupied: [CGRect] = []
            for place in marks.places.sorted(by: { ($0.id == marks.selectedPlace ? 0 : 1) < ($1.id == marks.selectedPlace ? 0 : 1) }) {
                guard let point = camera.project(longitude:place.lon,latitude:place.lat,size:size), bounds.contains(point) else { continue }
                let active = place.id == marks.selectedPlace
                let r: CGFloat = active ? 7 : 4
                let dot = Path(ellipseIn:CGRect(x:point.x-r,y:point.y-r,width:r*2,height:r*2))
                context.fill(dot,with:.color(place.precision == "site" || active ? Design.gold : Design.space))
                context.stroke(dot,with:.color(Design.gold),lineWidth:active ? 2 : 1.3)
                drawLabel(place.name,point:CGPoint(x:point.x+r+4,y:point.y),front:active,leading:true)
            }
            guard showNames else { return }
            let maxLabels = camera.zoom < 1.3 ? 8 : camera.zoom < 2.6 ? 15 : 27
            let minimumArea = 105 / max(1,camera.zoom * camera.zoom)
            var printed = Set<String>()
            let order = shapes.filter { $0.region.id == selected } + shapes.filter { $0.region.id != selected }
            for shape in order where occupied.count < maxLabels {
                let front = shape.region.id == selected
                guard front || Double(shape.area) > minimumArea, !printed.contains(shape.region.name) else { continue }
                for anchor in shape.anchors {
                    guard let position = camera.project(anchor,size:size), bounds.contains(position) else { continue }
                    let topShape = shapes.reversed().first { $0.bounds.contains(anchor) && $0.path.contains(anchor,using:.evenOdd) }
                    guard front || topShape?.region.id == shape.region.id else { continue }
                    if drawLabel(shape.region.name,point:position,front:front,leading:false) {
                        printed.insert(shape.region.name)
                        break
                    }
                }
            }

            @discardableResult func drawLabel(_ string: String,point: CGPoint,front: Bool,leading: Bool) -> Bool {
                let anchored: UnitPoint = leading ? .leading : .center
                let base = Text(string).font(.system(size:front ? 13 : 11,weight:front ? .semibold : .medium))
                let ink = base.foregroundColor(front ? Design.gold : .white.opacity(0.93))
                let measured = context.resolve(ink).measure(in:CGSize(width:bounds.width,height:24))
                let box = CGRect(x:leading ? point.x-3 : point.x-measured.width/2-4,
                                 y:point.y-measured.height/2-3,width:measured.width+8,height:measured.height+6)
                guard bounds.contains(box), !occupied.contains(where: { $0.intersects(box) }) else { return false }
                occupied.append(box)
                let shadow = base.foregroundColor(Design.space.opacity(0.92))
                for delta in [CGPoint(x:-1,y:0),CGPoint(x:1,y:0),CGPoint(x:0,y:-1),CGPoint(x:0,y:1)] {
                    context.draw(shadow,at:CGPoint(x:point.x+delta.x,y:point.y+delta.y),anchor:anchored)
                }
                context.draw(ink,at:point,anchor:anchored)
                return true
            }
        }
    }

    private func draw(_ route: SceneRoute, context: GraphicsContext, size: CGSize) {
        let coordinates = densifiedRoute(route.coordinates)
        let points = coordinates.map { camera.project(longitude:$0[0],latitude:$0[1],size:size) }
        let path = projectedLine(points)
        let dash: [CGFloat]
        switch route.precision {
        case "attested": dash = []
        case "approximate": dash = [7,5]
        default: dash = [1,5]
        }
        context.stroke(path,with:.color(Design.space.opacity(0.7)),lineWidth:4)
        context.stroke(path,with:.color(Design.gold.opacity(0.98)),style:StrokeStyle(lineWidth:2,lineCap:.round,dash:dash))
        if route.directed == true, route.directionEvidence?.isEmpty == false,
           let last = points.last ?? nil, points.count >= 4, let prior = points[points.count-4] {
            let angle = atan2(last.y-prior.y,last.x-prior.x)
            let arrow = Path { p in
                p.move(to:CGPoint(x:last.x-8*cos(angle-0.55),y:last.y-8*sin(angle-0.55)))
                p.addLine(to:last)
                p.addLine(to:CGPoint(x:last.x-8*cos(angle+0.55),y:last.y-8*sin(angle+0.55)))
            }
            context.stroke(arrow,with:.color(Design.gold),lineWidth:2)
        }
    }
}

private func projectedLine(_ points: [CGPoint?]) -> Path {
    Path { path in
        var connected = false
        for point in points {
            guard let point else { connected = false; continue }
            if connected { path.addLine(to:point) } else { path.move(to:point) }
            connected = true
        }
    }
}

private func densifiedRoute(_ raw: [[Double]]) -> [[Double]] {
    let vertices = raw.filter { $0.count == 2 }
    guard let end = vertices.last else { return [] }
    return zip(vertices,vertices.dropFirst()).flatMap { a,b in
        let dx = (b[0]-a[0]+540).truncatingRemainder(dividingBy:360)-180
        let dy = b[1]-a[1]
        let steps = max(2,min(48,Int(max(abs(dx),abs(dy))/3)))
        return (0..<steps).map { i in
            let t = Double(i)/Double(steps)
            return [a[0]+dx*t,a[1]+dy*t]
        }
    } + [end]
}
