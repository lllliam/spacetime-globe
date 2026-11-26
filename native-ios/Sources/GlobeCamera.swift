import Foundation
import CoreGraphics
import Combine

struct GlobeCamera: Codable, Hashable {
    var yaw = -1.65
    var tilt = 0.42
    var zoom = 1.0
    var verticalCenter = 0.48
    var offsetX = 0.0
    var offsetY = 0.0

    static let magnification = 0.85...7.0
    static let globalZoom = 1.06
    var isGlobal: Bool { zoom <= Self.globalZoom }

    var isValid: Bool {
        [yaw, tilt, zoom, verticalCenter, offsetX, offsetY].allSatisfy(\.isFinite) &&
            Self.magnification.contains(zoom) && (-1.57...1.57).contains(tilt) &&
            (0...1).contains(verticalCenter) && abs(offsetX) <= 2 && abs(offsetY) <= 2
    }

    mutating func center(longitude: Double, latitude: Double, zoom: Double) {
        yaw = -longitude * .pi / 180
        tilt = (latitude * .pi / 180).clamped(to: -1.54...1.54)
        self.zoom = zoom.clamped(to: Self.magnification)
        offsetX = 0
        offsetY = 0
    }

    func center(in size: CGSize) -> CGPoint {
        let unit = Double(min(size.width, size.height))
        return CGPoint(x: Double(size.width) * 0.5 + unit * offsetX,
                       y: Double(size.height) * verticalCenter + unit * offsetY)
    }

    func radius(in size: CGSize) -> Double {
        Double(min(size.width, size.height)) * 0.475 * zoom
    }

    func unproject(_ point: CGPoint, size: CGSize) -> CGPoint? {
        let origin = center(in: size), radius = radius(in: size)
        guard radius > 0 else { return nil }
        let x = (Double(point.x) - Double(origin.x)) / radius
        let y = (Double(origin.y) - Double(point.y)) / radius
        let square = 1 - x*x - y*y
        guard square >= 0 else { return nil }
        let z = sqrt(square)
        let latitude = asin((y*cos(tilt) + z*sin(tilt)).clamped(to: -1...1))
        let v = -y*sin(tilt) + z*cos(tilt)
        let longitude = atan2(x*cos(yaw) - v*sin(yaw), x*sin(yaw) + v*cos(yaw))
        return CGPoint(x: (longitude / (2 * .pi) + 0.5) * 1000,
                       y: (0.5 - latitude / .pi) * 500)
    }

    func project(longitude: Double, latitude: Double, size: CGSize) -> CGPoint? {
        let lon = longitude * .pi / 180, lat = latitude * .pi / 180
        let east = cos(lat) * sin(lon), north = sin(lat), near = cos(lat) * cos(lon)
        let x = east * cos(yaw) + near * sin(yaw)
        let v = -east * sin(yaw) + near * cos(yaw)
        guard north * sin(tilt) + v * cos(tilt) > 0 else { return nil }
        let y = north * cos(tilt) - v * sin(tilt)
        let origin = center(in: size), radius = radius(in: size)
        return CGPoint(x: Double(origin.x) + x * radius, y: Double(origin.y) - y * radius)
    }

    func project(_ mapPoint: CGPoint, size: CGSize) -> CGPoint? {
        project(longitude: Double(mapPoint.x) * 0.36 - 180, latitude: 90 - Double(mapPoint.y) * 0.36, size: size)
    }

    mutating func rotate(dx: Double, dy: Double, size: CGSize) {
        let ratio = 1 / max(65, radius(in: size))
        yaw = (yaw + dx * ratio).truncatingRemainder(dividingBy: 2 * .pi)
        tilt = (tilt + dy * ratio).clamped(to: -1.54...1.54)
    }

    @discardableResult mutating func magnify(_ change: Double, from previous: CGPoint, to current: CGPoint, size: CGSize) -> Bool {
        let old = zoom
        let requested = old * change
        zoom = requested.clamped(to: Self.magnification)
        let unit = Double(min(size.width, size.height))
        if unit > 0 {
            let origin = center(in:size)
            let ratio = zoom / old
            offsetX += Double(current.x - previous.x + (previous.x - origin.x) * (1 - ratio)) / unit
            offsetY += Double(current.y - previous.y + (previous.y - origin.y) * (1 - ratio)) / unit
            // Bound unresisted gesture input independently of what is shown on-screen.
            offsetX = offsetX.clamped(to:-3...3)
            offsetY = offsetY.clamped(to:-3...3)
        }
        return zoom != requested
    }

    func normalized() -> GlobeCamera {
        guard isValid else { return GlobeCamera() }
        var camera = limited(to:.zero,in:.zero)
        camera.verticalCenter = GlobeCamera().verticalCenter
        return camera
    }

    func limited(to size: CGSize, in aperture: CGRect, elastic: Bool = false) -> GlobeCamera {
        let unit = Double(min(size.width,size.height))
        let freedom = smoothstep(Self.globalZoom,2.45,zoom)
        let naturalLimit = min(2,0.48 + (zoom - Self.globalZoom)*0.28) * freedom
        let padding = unit * 0.23
        let radius = radius(in:size)
        let margin = elastic ? 0.12 * smoothstep(0.94,1.20,zoom) : 0
        let hasAperture = unit > 0 && aperture.height > 0
        let xLimit = hasAperture ? min(naturalLimit,max(0,(radius+aperture.width/2-padding)/unit)) : naturalLimit
        let yLimit = hasAperture ? min(naturalLimit,max(0,(radius+aperture.height/2-padding)/unit)) : naturalLimit

        func resist(_ value: Double, at limit: Double) -> Double {
            let overflow = max(0,abs(value)-limit)
            let length = min(abs(value),limit) + (margin > 0 ? margin*overflow/(margin+overflow) : 0)
            return value < 0 ? -length : length
        }
        var camera = self
        camera.offsetX = resist(offsetX,at:xLimit)
        camera.offsetY = resist(offsetY,at:yLimit)
        return camera
    }

    static func fitting(_ coordinates: [[Double]], in size: CGSize, visible area: CGRect) -> GlobeCamera {
        let points = coordinates.filter { $0.count == 2 && $0.allSatisfy(\.isFinite) }
        var result = GlobeCamera()
        guard size.width > 0, size.height > 0, area.height > 0 else { return result }
        result.verticalCenter = Double(area.midY / size.height).clamped(to: 0.15...0.85)
        guard !points.isEmpty else { return result }
        var x = 0.0, y = 0.0, z = 0.0
        for p in points {
            let lon = p[0] * .pi / 180, lat = p[1] * .pi / 180
            x += cos(lat) * cos(lon)
            y += cos(lat) * sin(lon)
            z += sin(lat)
        }
        let magnitude = hypot(x,y)
        guard magnitude > 1e-5 || abs(z) > 1e-5 else {
            result.center(longitude: points[0][0], latitude: points[0][1], zoom: 1)
            return result
        }
        let centerLon = atan2(y,x) * 180 / .pi
        let centerLat = atan2(z,magnitude) * 180 / .pi
        result.center(longitude:centerLon,latitude:centerLat,zoom:1)
        let origin = result.center(in:size)
        var maxX = 1.0, maxY = 1.0, invisible = false
        for point in points {
            guard let screen = result.project(longitude:point[0],latitude:point[1],size:size) else { invisible = true; continue }
            maxX = max(maxX, abs(Double(screen.x - origin.x)))
            maxY = max(maxY, abs(Double(screen.y - origin.y)))
        }
        let paddedX = max(20, Double(area.width / 2) - 32)
        let paddedY = max(20, Double(min(origin.y - area.minY, area.maxY - origin.y)) - 30)
        let fitted = min(paddedX/maxX,paddedY/maxY)
        result.zoom = invisible ? 0.94 : fitted.clamped(to: 0.94...(points.count == 1 ? 2.8 : 5.5))
        return result
    }
}


private func smoothstep(_ from: Double, _ to: Double, _ value: Double) -> Double {
    let fraction = ((value-from)/(to-from)).clamped(to:0...1)
    return fraction*fraction*(3-2*fraction)
}

enum GlobeIdleMotion {
    static let delay = 6.5

    static func yawDelta(elapsed: Double, eligibleFor duration: Double) -> Double {
        -0.04 * elapsed * smoothstep(delay,delay+1.35,duration)
    }
}

struct GlobeProjection {
    let size: CGSize
    let origin: CGPoint
    let radius: CGFloat
    let rotation: SIMD4<Float>

    init(camera: GlobeCamera, size: CGSize) {
        self.size = size
        origin = camera.center(in:size)
        radius = camera.radius(in:size)
        rotation = SIMD4(Float(cos(camera.yaw)), Float(sin(camera.yaw)),
                         Float(cos(camera.tilt)), Float(sin(camera.tilt)))
    }

    static func vector(_ point: CGPoint) -> SIMD3<Float> {
        vector(longitude:Double(point.x)*0.36 - 180, latitude:90 - Double(point.y)*0.36)
    }

    static func vector(longitude: Double, latitude: Double) -> SIMD3<Float> {
        let lon = longitude * .pi / 180, lat = latitude * .pi / 180
        return SIMD3(Float(cos(lat)*sin(lon)), Float(sin(lat)), Float(cos(lat)*cos(lon)))
    }

    func rotate(_ point: SIMD3<Float>) -> SIMD3<Float> {
        let z = -point.x * rotation.y + point.z * rotation.x
        return SIMD3(point.x * rotation.x + point.z * rotation.y,
                     point.y * rotation.z - z * rotation.w,
                     point.y * rotation.w + z * rotation.z)
    }

    func point(_ view: SIMD3<Float>) -> CGPoint {
        CGPoint(x:origin.x + CGFloat(view.x)*radius,y:origin.y - CGFloat(view.y)*radius)
    }

    func project(_ world: SIMD3<Float>) -> (point: CGPoint, depth: Float)? {
        let view = rotate(world)
        return view.z > 0 ? (point(view),view.z) : nil
    }
}

@MainActor
final class GlobeViewport: ObservableObject {
    enum IdleBlock: Hashable { case timeline, menu }

    // Changes on the display link intentionally do not emit objectWillChange.
    private(set) var camera: GlobeCamera
    private(set) var top: CGFloat = 0
    private var bottom: CGFloat = 0
    private var chromeBottom: CGFloat = 0
    private var touching = false
    private var touchesEndedAt = -Double.infinity
    var onChange: ((GlobeCamera?, Bool) -> Void)?
    var onIdleChange: (() -> Void)?
    private var idleBlocks: Set<IdleBlock> = []
    var permitsIdle: Bool { idleBlocks.isEmpty }

    init(_ camera: GlobeCamera) {
        self.camera = camera.normalized()
    }

    func move(to camera: GlobeCamera, animated: Bool = true) {
        if let onChange { onChange(camera,animated) }
        else { self.camera = camera.normalized() }
    }

    func present(_ camera: GlobeCamera) { self.camera = camera.normalized() }

    func setIdleBlock(_ source: IdleBlock, active: Bool) {
        let changed = active ? idleBlocks.insert(source).inserted : idleBlocks.remove(source) != nil
        if changed { onIdleChange?() }
    }

    func setMapTouch(_ isDown: Bool) {
        guard touching != isDown else { return }
        touching = isDown
        if !isDown { touchesEndedAt = ProcessInfo.processInfo.systemUptime }
    }

    var permitsTimelineTouch: Bool {
        // The two views can receive different fingers from the same UIKit event.
        !touching && ProcessInfo.processInfo.systemUptime-touchesEndedAt > 0.12
    }

    func protect(top: CGFloat? = nil, bottom: CGFloat? = nil, chromeBottom: CGFloat? = nil) {
        let newTop = top ?? self.top, newBottom = bottom ?? self.bottom
        let newChrome = chromeBottom ?? self.chromeBottom
        guard abs(newTop-self.top) > 0.1 || abs(newBottom-self.bottom) > 0.1 || abs(newChrome-self.chromeBottom) > 0.1 else { return }
        self.top = newTop
        self.bottom = newBottom
        self.chromeBottom = newChrome
        onChange?(nil,false)
    }

    func aperture(in size: CGSize) -> CGRect {
        let upper = min(top, size.height)
        return CGRect(x:0,y:upper,width:size.width,height:max(0,size.height-upper-max(bottom,chromeBottom)))
    }

    func display(_ camera: GlobeCamera, in size: CGSize) -> GlobeCamera {
        guard size.height > 0 else { return camera }
        let area = aperture(in:size)
        var result = camera
        result.verticalCenter = Double(area.midY/size.height).clamped(to:0...1)
        return result
    }

    func limit(_ camera: GlobeCamera, in size: CGSize, elastic: Bool = false) -> GlobeCamera {
        camera.limited(to:size,in:aperture(in:size),elastic:elastic)
    }

    func fit(_ coordinates: [[Double]], in size: CGSize, animated: Bool = true) {
        let space = aperture(in:size)
        guard space.height > 75 else { return }
        var target = GlobeCamera.fitting(coordinates,in:size,visible:space)
        target.verticalCenter = GlobeCamera().verticalCenter
        move(to:target,animated:animated)
    }
}
