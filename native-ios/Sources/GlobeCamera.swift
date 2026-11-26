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
        if unit > 0, zoom > 1 {
            let origin = center(in: size)
            let ratio = zoom / old
            let bound = (min(zoom, 4.2) - 1) * 0.29
            let dx = Double(current.x - previous.x) + Double(previous.x - origin.x) * (1 - ratio)
            let dy = Double(current.y - previous.y) + Double(previous.y - origin.y) * (1 - ratio)
            offsetX = (offsetX + dx / unit).clamped(to: -bound...bound)
            offsetY = (offsetY + dy / unit).clamped(to: -bound...bound)
        } else {
            offsetX = 0
            offsetY = 0
        }
        return zoom != requested
    }

    static func fitting(_ coordinates: [[Double]], in size: CGSize, visible area: CGRect) -> GlobeCamera {
        let points = coordinates.filter { $0.count == 2 && $0.allSatisfy(\.isFinite) }
        var result = GlobeCamera()
        guard size.width > 0, size.height > 0, area.height > 0 else { return result }
        result.verticalCenter = Double(area.midY / size.height).clamped(to: 0.19...0.6)
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

@MainActor
final class GlobeViewport: ObservableObject {
    @Published var camera: GlobeCamera
    init(_ camera: GlobeCamera) { self.camera = camera }
}
