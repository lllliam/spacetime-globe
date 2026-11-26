import SwiftUI
import UIKit

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
            artwork.allowsHitTesting(false).accessibilityHidden(true)

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
        .onChange(of:phase) { current in
            if current != .active { onSettled(viewport.camera) }
        }
    }

    private func settled(_ value: GlobeCamera) {
        highResolution = value.zoom > 2.8
        onSettled(value)
    }

    private var artwork: GlobeArtwork {
        let map = isCurrent || showPendingArt ? layer : nil
        return GlobeArtwork(camera:viewport.camera,shapes:map?.shapes ?? [],anchors:map?.labelAnchors ?? [],
                            selected:isCurrent ? selected : nil,marks:isCurrent ? marks : GlobeMarks(),
                            top:protectedTop,bottom:protectedBottom,showNames:showNames && !rendererError)
    }

    private func tap(_ location: CGPoint, _ size: CGSize) {
        guard isCurrent, let layer, !rendererError else { return }
        if let hit = artwork.labels(in:size).first(where:{ $0.bounds.contains(location) }) {
            if hit.isPlace { onPlace(hit.id); return }
            if let region = layer.shapes.first(where:{ $0.region.id == hit.id })?.region {
                let overlaps = viewport.camera.unproject(location,size:size).map(layer.picks(at:)) ?? []
                onRegions([region] + overlaps.filter { $0.id != region.id })
                return
            }
        }
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
    let anchors: [[CGPoint]]
    let selected: String?
    let marks: GlobeMarks
    let top: CGFloat
    let bottom: CGFloat
    let showNames: Bool

    struct LabelPlacement {
        let id: String
        let name: String
        let point: CGPoint
        let bounds: CGRect
        let front: Bool
        let isPlace: Bool
    }

    private var focus: Set<String> { Set(marks.focusPolities.map { $0.hasPrefix("polity:") ? $0 : "polity:" + $0 }) }
    private func protectedArea(_ size: CGSize) -> CGRect {
        CGRect(x:8,y:top,width:max(0,size.width-16),height:max(0,size.height-top-bottom))
    }

    var body: some View {
        Canvas { context, size in
            let bounds = protectedArea(size)
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

            for place in marks.places {
                guard let point = camera.project(longitude:place.lon,latitude:place.lat,size:size), bounds.contains(point) else { continue }
                let active = place.id == marks.selectedPlace
                let r: CGFloat = active || place.precision == "region" ? 7 : 4
                let dot: Path
                if place.precision == "reference" {
                    dot = Path { path in
                        path.addLines([CGPoint(x:point.x,y:point.y-r),CGPoint(x:point.x+r,y:point.y),
                                       CGPoint(x:point.x,y:point.y+r),CGPoint(x:point.x-r,y:point.y)])
                        path.closeSubpath()
                    }
                } else {
                    dot = Path(ellipseIn:CGRect(x:point.x-r,y:point.y-r,width:r*2,height:r*2))
                }
                let fill = place.precision == "region" ? Design.gold.opacity(0.17) :
                    place.precision == "site" || active ? Design.gold : Design.space
                let dash: [CGFloat] = place.precision == "region" ? [2,2] : []
                context.fill(dot,with:.color(fill))
                context.stroke(dot,with:.color(Design.gold),style:StrokeStyle(lineWidth:active ? 2 : 1.3,dash:dash))
            }
            for label in labels(in:size) {
                let anchor: UnitPoint = label.isPlace ? .leading : .center
                let base = Text(label.name).font(.system(size:label.front ? 13 : 11,weight:label.front ? .semibold : .medium))
                let ink = base.foregroundColor(label.front ? Design.gold : .white.opacity(0.93))
                let shadow = base.foregroundColor(Design.space.opacity(0.92))
                for delta in [CGPoint(x:-1,y:0),CGPoint(x:1,y:0),CGPoint(x:0,y:-1),CGPoint(x:0,y:1)] {
                    context.draw(shadow,at:CGPoint(x:label.point.x+delta.x,y:label.point.y+delta.y),anchor:anchor)
                }
                context.draw(ink,at:label.point,anchor:anchor)
            }
        }
    }

    func labels(in size: CGSize) -> [LabelPlacement] {
        let area = protectedArea(size)
        var chosen: [LabelPlacement] = []
        func add(_ name: String,id: String,at position: CGPoint,front: Bool,place: Bool) -> Bool {
            let font = UIFont.systemFont(ofSize:front ? 13 : 11,weight:front ? .semibold : .medium)
            let measurement = (name as NSString).size(withAttributes:[.font:font])
            let box = CGRect(x:place ? position.x-3 : position.x-measurement.width/2-4,
                             y:position.y-measurement.height/2-3,width:measurement.width+8,height:measurement.height+6)
            guard area.contains(box), !chosen.contains(where:{ $0.bounds.intersects(box) }) else { return false }
            chosen.append(LabelPlacement(id:id,name:name,point:position,bounds:box,front:front,isPlace:place))
            return true
        }
        let places = marks.places.filter { $0.id == marks.selectedPlace } + marks.places.filter { $0.id != marks.selectedPlace }
        for place in places {
            guard let point = camera.project(longitude:place.lon,latitude:place.lat,size:size), area.contains(point) else { continue }
            let front = place.id == marks.selectedPlace
            let gap: CGFloat = front || place.precision == "region" ? 11 : 8
            _ = add(place.name,id:place.id,at:CGPoint(x:point.x+gap,y:point.y),front:front,place:true)
        }
        guard showNames || !focus.isEmpty else { return chosen }
        let maxLabels = camera.zoom < 1.3 ? 8 : camera.zoom < 2.6 ? 15 : 27
        let minimumArea = 105 / max(1,camera.zoom * camera.zoom)
        var printed = Set<String>()
        let order = shapes.indices.filter { shapes[$0].region.id == selected } +
            shapes.indices.filter { shapes[$0].region.id != selected }
        for index in order where chosen.count < maxLabels {
            let shape = shapes[index]
            if !showNames && !focus.contains(shape.region.id) { continue }
            let front = shape.region.id == selected
            guard front || Double(shape.area)>minimumArea, !printed.contains(shape.region.name) else { continue }
            for anchor in front ? shape.anchors : anchors[index] {
                guard let position = camera.project(anchor,size:size),area.contains(position) else { continue }
                if add(shape.region.name,id:shape.region.id,at:position,front:front,place:false) {
                    printed.insert(shape.region.name)
                    break
                }
            }
        }
        return chosen
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
