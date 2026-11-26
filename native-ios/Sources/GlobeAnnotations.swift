import UIKit

struct GlobeMarks {
    var places: [ScenePlace] = []
    var routes: [SceneRoute] = []
    var focusPolities: [String] = []
    var selectedPlace: String?

    var geometryKey: [String] { places.map(\.id) + routes.map(\.id) }
}

@MainActor
final class GlobeAnnotations {
    struct Hit {
        let id: String
        let frame: CGRect
        let place: Bool
    }

    private struct AnchorGroup {
        let id: String
        let name: String
        let vectors: [SIMD3<Float>]
        let radiansSquared: CGFloat
    }

    private struct Label {
        let layer: CATextLayer
        var visible = false
    }

    private struct Candidate {
        let id: String
        let name: String
        let anchors: [(Int, CGPoint)]
        let priority: CGFloat
        let emphasized: Bool
        let place: Bool
    }

    private let root = CALayer()
    private let artwork = CALayer()
    private let text = CALayer()
    private var regions: [AnchorGroup] = []
    private var regionGeneration: UUID?
    private var placeGeometry: [(ScenePlace,SIMD3<Float>,CAShapeLayer)] = []
    private var routeGeometry: [(SceneRoute,[SIMD3<Float>],CAShapeLayer,CAShapeLayer)] = []
    private var marks = GlobeMarks()
    private var labels: [String: Label] = [:]
    private var measurements: [String: CGSize] = [:]
    private var retained: [String: Int] = [:]
    private var tier = 0
    private var lastLayout = -1.0
    private var labelHits: [Hit] = []
    private var placeHits: [Hit] = []
    private let gold = UIColor(red:0.96,green:0.84,blue:0.61,alpha:1)
    private let ink = UIColor(red:0.035,green:0.057,blue:0.079,alpha:1)

    init(in layer: CALayer) {
        layer.addSublayer(root)
        root.masksToBounds = true
        root.addSublayer(artwork)
        root.addSublayer(text)
    }

    func use(map: PaintedAtlas?, marks: GlobeMarks, sceneChanged: Bool) {
        if regionGeneration != map?.generation {
            regionGeneration = map?.generation
            regions = map.map { atlas in
                atlas.shapes.enumerated().compactMap { index, shape in
                    let anchors = atlas.labelAnchors[index].prefix(12).map(GlobeProjection.vector)
                    guard !anchors.isEmpty else { return nil }
                    let latitude = (90 - shape.center.y*0.36) * .pi / 180
                    let projected = shape.area * pow(CGFloat.pi/500,2) * max(0.18,cos(latitude))
                    return AnchorGroup(id:shape.region.id,name:shape.region.name,vectors:anchors,radiansSquared:projected)
                }
            } ?? []
            lastLayout = -1
        }
        if sceneChanged {
            artwork.sublayers = nil
            placeGeometry = marks.places.map { place in
                let layer = CAShapeLayer()
                artwork.addSublayer(layer)
                return (place,GlobeProjection.vector(longitude:place.lon,latitude:place.lat),layer)
            }
            routeGeometry = marks.routes.map { route in
                let shadow = CAShapeLayer(), line = CAShapeLayer()
                for layer in [shadow,line] {
                    artwork.insertSublayer(layer,at:0)
                    layer.fillColor = nil
                    layer.lineCap = .round
                    layer.lineJoin = .round
                }
                artwork.insertSublayer(shadow,below:line)
                shadow.strokeColor = ink.withAlphaComponent(0.7).cgColor
                shadow.lineWidth = 3.6
                line.strokeColor = gold.cgColor
                line.lineWidth = 1.7
                line.lineDashPattern = route.precision == "attested" ? nil :
                    (route.precision == "approximate" ? [7,5] : [1,5])
                return (route,Self.routeVectors(route.coordinates),shadow,line)
            }
            lastLayout = -1
        }
        if self.marks.selectedPlace != marks.selectedPlace { lastLayout = -1 }
        self.marks = marks
    }

    func invalidate() { lastLayout = -1 }

    func render(_ projection: GlobeProjection, aperture: CGRect, camera: GlobeCamera,
                selected: String?, showNames: Bool, screenScale: CGFloat, time: Double, reduced: Bool) {
        let area = aperture.insetBy(dx:9,dy:7)
        let valid = area.width > 0 && area.height > 0
        let viewport = CGRect(origin:.zero,size:projection.size)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        root.frame = viewport
        artwork.frame = viewport
        text.frame = viewport
        root.isHidden = !valid
        guard valid else {
            labelHits = []
            placeHits = []
            CATransaction.commit()
            return
        }
        placeHits = drawGeography(projection,in:area)
        let magnification = min(camera.zoom,projection.radius*2/max(1,projection.size.width)*1.07)
        let thresholds = [1.22, 2.05, 3.45]
        while tier < thresholds.count && magnification > thresholds[tier] + 0.04 { tier += 1 }
        while tier > 0 && magnification < thresholds[tier-1] - 0.09 { tier -= 1 }

        let shouldReflow = time - lastLayout > 1/26 || lastLayout < 0
        if shouldReflow { lastLayout = time }
        var candidates: [Candidate] = []
        for (place,vector,_) in placeGeometry {
            let front = place.id == marks.selectedPlace
            guard let projected = projection.project(vector), projected.depth > 0.14,
                  area.contains(projected.point) else { continue }
            let point = CGPoint(x:projected.point.x + (front || place.precision == "region" ? 12 : 9),
                                y:projected.point.y)
            candidates.append(Candidate(id:place.id,name:place.name,anchors:[(0,point)],
                                        priority:front ? 150 : 80,emphasized:front,place:true))
        }
        let focused = Set(marks.focusPolities.map { $0.hasPrefix("polity:") ? $0 : "polity:" + $0 })
        if selected != nil || !focused.isEmpty || (showNames && tier > 0) {
            let minArea: CGFloat = [2200, 1580, 790, 370][tier]
            for region in regions {
                let front = selected == region.id
                let relevant = focused.contains(region.id)
                guard front || (relevant && tier >= 1) || (showNames && tier > 0) else { continue }
                let old = retained[region.id]
                // Longitude, latitude, facing and on-screen anchor count approximate readable area.
                let areaBeforeProjection = region.radiansSquared * projection.radius * projection.radius
                guard front || areaBeforeProjection >= minArea * 0.65 else { continue }
                var points: [(Int,CGPoint)] = []
                var bestDepth: Float = 0
                for (index,world) in region.vectors.enumerated() {
                    if !shouldReflow && old != index { continue }
                    guard let p = projection.project(world), p.depth >= (old == index ? 0.16 : 0.23),
                          area.contains(p.point) else { continue }
                    bestDepth = max(bestDepth,p.depth)
                    points.append((index,p.point))
                }
                guard !points.isEmpty else { continue }
                let fraction = shouldReflow ? min(1, CGFloat(points.count) / CGFloat(min(4,region.vectors.count))) : 1
                let projectedArea = areaBeforeProjection * CGFloat(bestDepth) * fraction
                let threshold = old != nil ? minArea*0.67 : minArea
                guard front || projectedArea >= threshold else { continue }
                let context = selected == nil || relevant ? 0.0 : -6.0
                let priority: CGFloat = front ? 120 : (relevant ? 58 : 0)
                    + min(40,log2(max(1,projectedArea))*1.9) + (old == nil ? 0 : 4) + context
                candidates.append(Candidate(id:region.id,name:region.name,anchors:points,priority:priority,
                                            emphasized:front,place:false))
            }
        }
        candidates.sort { $0.priority == $1.priority ? $0.id < $1.id : $0.priority > $1.priority }
        var used: [CGRect] = []
        var next: [String:Int] = [:]
        var names = Set<String>()
        var hits: [Hit] = []
        var ordinary = 0
        var sites = 0
        let ordinaryLimit = selected == nil ? [0,5,12,22][tier] : [0,3,7,13][tier]
        let placeLimit = [4,7,12,18][tier]
        for candidate in candidates {
            guard candidate.emphasized || (candidate.place ? sites < placeLimit : ordinary < ordinaryLimit),
                  !names.contains(candidate.name) else { continue }
            let old = retained[candidate.id]
            let points = candidate.anchors.sorted {
                if $0.0 == old { return $1.0 != old }
                if $1.0 == old { return false }
                return $0.0 < $1.0
            }
            let font = UIFont.systemFont(ofSize:candidate.emphasized ? 13 : 11,
                                         weight:candidate.emphasized ? .semibold : .medium)
            let measureKey = candidate.name + (candidate.emphasized ? "\u{1}" : "")
            let measured = measurements[measureKey] ?? (candidate.name as NSString).size(withAttributes:[.font:font])
            measurements[measureKey] = measured
            for (index,point) in points {
                let frame = CGRect(x:candidate.place ? point.x : point.x-ceil(measured.width)/2,
                                   y:point.y-ceil(measured.height)/2,width:ceil(measured.width)+2,
                                   height:ceil(measured.height)+1)
                let collision = frame.insetBy(dx:-5,dy:-4)
                guard area.contains(collision), !used.contains(where:{ $0.intersects(collision) }) else { continue }
                used.append(collision)
                next[candidate.id] = index
                names.insert(candidate.name)
                if !candidate.emphasized { if candidate.place { sites += 1 } else { ordinary += 1 } }
                display(candidate,frame:frame,font:font,scale:screenScale,
                        opacity:selected != nil && !candidate.emphasized && !candidate.place ? 0.64 : 1,
                        reduced:reduced)
                hits.append(Hit(id:candidate.id,frame:frame.insetBy(dx:-5,dy:-6),place:candidate.place))
                break
            }
        }
        for id in Array(labels.keys) where next[id] == nil && labels[id]?.visible == true {
            setVisible(id,false,opacity:0,reduced:reduced)
        }
        if labels.count > 100 {
            for id in Array(labels.keys) where labels[id]?.visible == false {
                labels.removeValue(forKey:id)?.layer.removeFromSuperlayer()
            }
        }
        retained = next
        labelHits = hits
        CATransaction.commit()
    }

    func hit(_ point: CGPoint) -> Hit? {
        labelHits.first { $0.frame.contains(point) } ??
            placeHits.filter { $0.frame.contains(point) }.min {
                hypot($0.frame.midX-point.x,$0.frame.midY-point.y) < hypot($1.frame.midX-point.x,$1.frame.midY-point.y)
            }
    }

    private func display(_ candidate: Candidate, frame: CGRect, font: UIFont, scale: CGFloat,
                         opacity: Float, reduced: Bool) {
        let id = candidate.id
        let layer: CATextLayer
        if let entry = labels[id] { layer = entry.layer }
        else {
            layer = CATextLayer()
            layer.opacity = 0
            layer.alignmentMode = candidate.place ? .left : .center
            layer.shadowColor = UIColor.black.cgColor
            layer.shadowOffset = CGSize(width:0,height:1)
            layer.shadowRadius = 2
            layer.shadowOpacity = 0.84
            text.addSublayer(layer)
            labels[id] = Label(layer:layer)
        }
        layer.frame = frame
        layer.contentsScale = scale
        layer.font = CGFont(font.fontName as CFString)
        layer.fontSize = font.pointSize
        layer.foregroundColor = candidate.emphasized ? gold.cgColor : UIColor.white.withAlphaComponent(0.94).cgColor
        if (layer.string as? String) != candidate.name { layer.string = candidate.name }
        setVisible(id,true,opacity:opacity,reduced:reduced)
    }

    private func setVisible(_ id: String, _ visible: Bool, opacity: Float, reduced: Bool) {
        guard var entry = labels[id], entry.visible != visible || entry.layer.opacity != opacity else { return }
        let layer = entry.layer
        if !reduced {
            let fade = CABasicAnimation(keyPath:"opacity")
            fade.fromValue = layer.presentation()?.opacity ?? layer.opacity
            fade.toValue = opacity
            fade.duration = visible ? 0.18 : 0.14
            layer.add(fade,forKey:"visibility")
        } else {
            layer.removeAnimation(forKey:"visibility")
        }
        layer.opacity = opacity
        entry.visible = visible
        labels[id] = entry
    }

    private func drawGeography(_ frame: GlobeProjection, in area: CGRect) -> [Hit] {
        for (route,world,shadow,line) in routeGeometry {
            let points = world.map { frame.project($0)?.point }
            let path = CGMutablePath()
            var connected = false
            for point in points {
                guard let p = point else { connected = false; continue }
                if connected { path.addLine(to:p) } else { path.move(to:p) }
                connected = true
            }
            if route.directed == true, route.directionEvidence?.isEmpty == false, points.count >= 4,
               let last = points.last ?? nil, let prior = points[points.count-4] {
                let direction = atan2(last.y-prior.y,last.x-prior.x)
                path.move(to:CGPoint(x:last.x-8*cos(direction-0.55),y:last.y-8*sin(direction-0.55)))
                path.addLine(to:last)
                path.addLine(to:CGPoint(x:last.x-8*cos(direction+0.55),y:last.y-8*sin(direction+0.55)))
            }
            shadow.path = path
            line.path = path
        }
        return placeGeometry.compactMap { place,world,layer in
            guard let p = frame.project(world), p.depth > 0.055, area.contains(p.point) else {
                layer.isHidden = true
                return nil
            }
            layer.isHidden = false
            let active = place.id == marks.selectedPlace
            let radius: CGFloat = active || place.precision == "region" ? 7 : 4
            let point = p.point
            let dot = CGRect(x:point.x-radius,y:point.y-radius,width:radius*2,height:radius*2)
            if place.precision == "reference" {
                let diamond = CGMutablePath()
                diamond.move(to:CGPoint(x:point.x,y:dot.minY))
                diamond.addLine(to:CGPoint(x:dot.maxX,y:point.y))
                diamond.addLine(to:CGPoint(x:point.x,y:dot.maxY))
                diamond.addLine(to:CGPoint(x:dot.minX,y:point.y))
                diamond.closeSubpath()
                layer.path = diamond
            } else {
                layer.path = CGPath(ellipseIn:dot,transform:nil)
            }
            layer.lineWidth = active ? 1.9 : 1.2
            layer.strokeColor = gold.cgColor
            layer.fillColor = place.precision == "region" ? gold.withAlphaComponent(0.19).cgColor :
                (place.precision == "site" || active ? gold.cgColor : ink.cgColor)
            layer.lineDashPattern = place.precision == "region" ? [2,2] : nil
            return Hit(id:place.id,frame:CGRect(x:point.x-22,y:point.y-22,width:44,height:44),place:true)
        }
    }

    private static func routeVectors(_ raw: [[Double]]) -> [SIMD3<Float>] {
        let vertices = raw.filter { $0.count == 2 }
        guard let last = vertices.last else { return [] }
        var result: [SIMD3<Float>] = []
        for (a,b) in zip(vertices,vertices.dropFirst()) {
            let dx = (b[0]-a[0]+540).truncatingRemainder(dividingBy:360)-180
            let dy = b[1]-a[1]
            let steps = max(2,min(96,Int(max(abs(dx),abs(dy))/2)))
            for i in 0..<steps {
                let t = Double(i)/Double(steps)
                result.append(GlobeProjection.vector(longitude:a[0]+dx*t,latitude:a[1]+dy*t))
            }
        }
        result.append(GlobeProjection.vector(longitude:last[0],latitude:last[1]))
        return result
    }
}
