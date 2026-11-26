import MetalKit
import SwiftUI

struct GlobeCamera: Equatable {
    var yaw = -1.65
    var tilt = 0.42
    var zoom = 1.0
    var verticalCenter = 0.48

    mutating func center(longitude: Double, latitude: Double, zoom: Double) {
        yaw = -longitude * .pi / 180
        tilt = latitude * .pi / 180
        self.zoom = zoom
    }

    func center(in size: CGSize) -> CGPoint {
        CGPoint(x: size.width * 0.5, y: size.height * verticalCenter)
    }

    func radius(in size: CGSize) -> Double {
        Double(min(size.width, size.height)) * 0.425 * zoom
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
}

extension Comparable {
    func clamped(to bounds: ClosedRange<Self>) -> Self {
        min(max(self, bounds.lowerBound), bounds.upperBound)
    }
}

struct AtlasRequest: Equatable {
    let layer: GlobeLayer
    let year: Int
    let selected: String?
}

struct NativeGlobe: View {
    let atlas: GlobeAtlas
    let resources: URL
    let request: AtlasRequest
    @Binding var camera: GlobeCamera
    var showNames = true
    var places: [ScenePlace] = []
    var routes: [SceneRoute] = []
    var onRegion: (MapRegion?) -> Void = { _ in }

    @State private var painted: PaintedAtlas?
    @State private var error: String?
    @State private var renderError: String?

    var body: some View {
        ZStack {
            Color(red: 0.044, green: 0.063, blue: 0.085)
            MetalSurface(resources: resources, camera: $camera, image: painted?.image, onError: {
                renderError = $0
            }, onTap: { point in
                onRegion(painted?.pick(at: point))
            })
            if renderError == nil {
                Canvas { context, size in
                    paintLabels(context, size: size)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            if let message = renderError ?? error {
                Text(message).font(.footnote).padding(10).background(.black.opacity(0.8), in: Capsule())
                    .foregroundStyle(.white).allowsHitTesting(false)
            }
        }
        .task(id: request) {
            let load = Task.detached(priority: .userInitiated) {
                try atlas.paint(layer: request.layer, year: request.year, selected: request.selected)
            }
            do {
                let result = try await load.value
                guard !Task.isCancelled else { return }
                painted = result
                error = nil
            } catch {
                guard !Task.isCancelled else { return }
                self.error = "当前年份的地图数据无法打开"
            }
        }
    }

    private func paintLabels(_ context: GraphicsContext, size: CGSize) {
        for route in routes {
            var path = Path()
            var active = false
            for pair in route.coordinates where pair.count == 2 {
                guard let point = camera.project(longitude: pair[0], latitude: pair[1], size: size) else {
                    active = false
                    continue
                }
                if active { path.addLine(to: point) } else { path.move(to: point) }
                active = true
            }
            context.stroke(path, with: .color(.black.opacity(0.75)), lineWidth: 4)
            context.stroke(path, with: .color(.orange), style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
        }
        var labels: [CGRect] = []
        for place in places {
            guard let point = camera.project(longitude: place.lon, latitude: place.lat, size: size) else { continue }
            let dot = Path(ellipseIn: CGRect(x: point.x - 4, y: point.y - 4, width: 8, height: 8))
            context.fill(dot, with: .color(.orange))
            context.stroke(dot, with: .color(.black), lineWidth: 1)
            draw(place.name, near: CGPoint(x: point.x + 7, y: point.y), leading: true, emphatic: true)
        }
        guard showNames else { return }
        let shapes = painted?.shapes ?? []
        let ordered = shapes.filter { $0.region.id == request.selected } + shapes.filter { $0.region.id != request.selected }
        for shape in ordered where labels.count < 32 {
            let selected = shape.region.id == request.selected
            guard selected || shape.area * camera.zoom * camera.zoom > 33,
                  let point = camera.project(longitude: Double(shape.center.x) * 0.36 - 180,
                                             latitude: 90 - Double(shape.center.y) * 0.36, size: size) else { continue }
            draw(shape.region.name, near: point, leading: false, emphatic: selected)
        }

        func draw(_ string: String, near point: CGPoint, leading: Bool, emphatic: Bool) {
            let text = Text(string).font(.system(size: emphatic ? 12 : 10, weight: .semibold)).foregroundColor(.white)
            let measured = context.resolve(text).measure(in: size)
            let box = CGRect(x: leading ? point.x - 3 : point.x - measured.width / 2 - 3,
                             y: point.y - measured.height / 2 - 2, width: measured.width + 6, height: measured.height + 4)
            guard CGRect(origin: .zero, size: size).contains(box),
                  !labels.contains(where: { $0.intersects(box) }) else { return }
            labels.append(box)
            context.fill(Path(roundedRect: box, cornerRadius: 3), with: .color(.black.opacity(0.65)))
            context.draw(text, at: point, anchor: leading ? .leading : .center)
        }
    }
}

private struct MetalSurface: UIViewRepresentable {
    let resources: URL
    @Binding var camera: GlobeCamera
    let image: CGImage?
    let onError: (String) -> Void
    let onTap: (CGPoint) -> Void

    func makeCoordinator() -> Renderer { Renderer(parent: self) }

    func makeUIView(context: Context) -> MTKView {
        let view = MTKView(frame: .zero, device: MTLCreateSystemDefaultDevice())
        view.isPaused = true
        view.enableSetNeedsDisplay = true
        view.isMultipleTouchEnabled = true
        view.colorPixelFormat = .bgra8Unorm
        view.clearColor = MTLClearColor(red: 0.044, green: 0.063, blue: 0.085, alpha: 1)
        view.backgroundColor = UIColor(red: 0.044, green: 0.063, blue: 0.085, alpha: 1)
        view.isAccessibilityElement = true
        view.accessibilityLabel = "历史地球"
        view.accessibilityHint = "拖动旋转，双指缩放，轻点查看疆域"
        context.coordinator.install(in: view)
        return view
    }

    func updateUIView(_ view: MTKView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.setOverlay(image)
        view.setNeedsDisplay()
    }

    final class Renderer: NSObject, MTKViewDelegate, UIGestureRecognizerDelegate {
        var parent: MetalSurface
        private var queue: MTLCommandQueue?
        private var pipeline: MTLRenderPipelineState?
        private var loader: MTKTextureLoader?
        private var earth: MTLTexture?
        private var clouds: MTLTexture?
        private var terrain: MTLTexture?
        private var blank: MTLTexture?
        private var overlay: MTLTexture?
        private var overlayImage: CGImage?
        private let textureOptions: [MTKTextureLoader.Option: Any] = [
            .origin: MTKTextureLoader.Origin.topLeft, .SRGB: false
        ]

        init(parent: MetalSurface) { self.parent = parent }

        func install(in view: MTKView) {
            view.delegate = self
            let pan = UIPanGestureRecognizer(target: self, action: #selector(pan(_:)))
            pan.maximumNumberOfTouches = 1
            let pinch = UIPinchGestureRecognizer(target: self, action: #selector(pinch(_:)))
            let tap = UITapGestureRecognizer(target: self, action: #selector(tap(_:)))
            let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTap(_:)))
            doubleTap.numberOfTapsRequired = 2
            tap.require(toFail: doubleTap)
            [pan, pinch, tap, doubleTap].forEach { view.addGestureRecognizer($0) }
            do {
                guard let device = view.device, let queue = device.makeCommandQueue() else {
                    throw RendererError.unavailable
                }
                self.queue = queue
                let loader = MTKTextureLoader(device: device)
                self.loader = loader
                let resources = parent.resources
                let source = try String(contentsOf: resources.appendingPathComponent("Globe.metal.txt"), encoding: .utf8)
                let library = try device.makeLibrary(source: source, options: nil)
                let descriptor = MTLRenderPipelineDescriptor()
                descriptor.vertexFunction = library.makeFunction(name: "globeVertex")
                descriptor.fragmentFunction = library.makeFunction(name: "globeFragment")
                descriptor.colorAttachments[0].pixelFormat = view.colorPixelFormat
                pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
                earth = try loader.newTexture(URL: resources.appendingPathComponent("earth-detail.jpg"), options: textureOptions)
                clouds = try loader.newTexture(URL: resources.appendingPathComponent("clouds.png"), options: textureOptions)
                terrain = try loader.newTexture(URL: resources.appendingPathComponent("terrain-4k-v1.png"), options: textureOptions)
                let texture = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: 1, height: 1, mipmapped: false)
                texture.storageMode = .shared
                blank = device.makeTexture(descriptor: texture)
                var clear: UInt32 = 0
                blank?.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: &clear, bytesPerRow: 4)
            } catch {
                NSLog("Globe rendering initialization: %@", String(describing: error))
                DispatchQueue.main.async { self.parent.onError("地球渲染暂不可用") }
            }
        }

        private enum RendererError: Error { case unavailable }

        func setOverlay(_ image: CGImage?) {
            guard overlayImage !== image else { return }
            overlayImage = image
            overlay = image.flatMap { try? loader?.newTexture(cgImage: $0, options: textureOptions) }
        }

        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) { view.setNeedsDisplay() }

        func draw(in view: MTKView) {
            guard let pipeline, let earth, let clouds, let terrain, let boundaries = overlay ?? blank,
                  let drawable = view.currentDrawable, let pass = view.currentRenderPassDescriptor,
                  let commands = queue?.makeCommandBuffer(), let encoder = commands.makeRenderCommandEncoder(descriptor: pass)
            else { return }
            let camera = parent.camera, size = view.drawableSize, center = camera.center(in: size)
            let position = SIMD4<Float>(Float(center.x), Float(center.y), Float(camera.radius(in: size)), Float(camera.zoom))
            let rotation = SIMD4<Float>(Float(cos(camera.yaw)), Float(sin(camera.yaw)),
                                        Float(cos(camera.tilt)), Float(sin(camera.tilt)))
            var uniforms = [position, rotation]
            encoder.setRenderPipelineState(pipeline)
            uniforms.withUnsafeBytes { bytes in
                if let address = bytes.baseAddress { encoder.setFragmentBytes(address, length: bytes.count, index: 0) }
            }
            encoder.setFragmentTexture(earth, index: 0)
            encoder.setFragmentTexture(boundaries, index: 1)
            encoder.setFragmentTexture(clouds, index: 2)
            encoder.setFragmentTexture(terrain, index: 3)
            encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
            encoder.endEncoding()
            commands.present(drawable)
            commands.commit()
        }

        @objc private func pan(_ gesture: UIPanGestureRecognizer) {
            guard let view = gesture.view, gesture.state == .changed else { return }
            let delta = gesture.translation(in: view)
            let ratio = 1 / max(90, parent.camera.radius(in: view.bounds.size))
            parent.camera.yaw = (parent.camera.yaw + Double(delta.x) * ratio).truncatingRemainder(dividingBy: 2 * .pi)
            parent.camera.tilt = (parent.camera.tilt + Double(delta.y) * ratio).clamped(to: -1.54...1.54)
            gesture.setTranslation(.zero, in: view)
        }

        @objc private func pinch(_ gesture: UIPinchGestureRecognizer) {
            guard gesture.state == .changed else { return }
            parent.camera.zoom = (parent.camera.zoom * Double(gesture.scale)).clamped(to: 0.85...7)
            gesture.scale = 1
        }

        @objc private func tap(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view, let point = parent.camera.unproject(gesture.location(in: view), size: view.bounds.size)
            else { return }
            parent.onTap(point)
        }

        @objc private func doubleTap(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view else { return }
            if parent.camera.zoom > 1.1 {
                parent.camera.zoom = 1
            } else if let point = parent.camera.unproject(gesture.location(in: view), size: view.bounds.size) {
                parent.camera.center(longitude: Double(point.x) * 0.36 - 180,
                                     latitude: 90 - Double(point.y) * 0.36, zoom: 2.4)
            }
        }
    }
}
