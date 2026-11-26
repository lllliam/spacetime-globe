import MetalKit
import SwiftUI

struct MetalSurface: UIViewRepresentable {
    let resources: URL
    @Binding var camera: GlobeCamera
    let image: CGImage?
    let active: Bool
    let reduceMotion: Bool
    let onError: () -> Void
    let onBoundary: () -> Void
    let onSettled: (GlobeCamera) -> Void
    let onTap: (CGPoint,CGSize) -> Void

    func makeCoordinator() -> Renderer { Renderer(parent:self) }

    func makeUIView(context: Context) -> MTKView {
        let view = MTKView(frame:.zero,device:MTLCreateSystemDefaultDevice())
        view.isPaused = true
        view.enableSetNeedsDisplay = true
        view.isMultipleTouchEnabled = true
        view.colorPixelFormat = .bgra8Unorm
        view.clearColor = MTLClearColor(red:0.039,green:0.063,blue:0.086,alpha:1)
        view.backgroundColor = UIColor(red:0.039,green:0.063,blue:0.086,alpha:1)
        view.isAccessibilityElement = true
        view.accessibilityLabel = "历史地球"
        view.accessibilityIdentifier = "history-globe"
        view.accessibilityHint = "拖动旋转，双指缩放。也可使用缩放辅助操作。"
        context.coordinator.install(view)
        return view
    }

    func updateUIView(_ view: MTKView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.setOverlay(image)
        if active { view.setNeedsDisplay() } else { coordinator.cancelMotion() }
    }

    static func dismantleUIView(_ view: MTKView, coordinator: Renderer) {
        coordinator.cancelMotion()
        view.delegate = nil
    }

    final class Renderer: NSObject, MTKViewDelegate, UIGestureRecognizerDelegate {
        var parent: MetalSurface
        private weak var view: MTKView?
        private var queue: MTLCommandQueue?
        private var pipeline: MTLRenderPipelineState?
        private var loader: MTKTextureLoader?
        private var earth: MTLTexture?
        private var clouds: MTLTexture?
        private var terrain: MTLTexture?
        private var blank: MTLTexture?
        private var overlay: MTLTexture?
        private var overlayImage: CGImage?
        private var pinchCenter: CGPoint?
        private var reachedLimit = false
        private var displayLink: CADisplayLink?
        private var velocity = CGPoint.zero
        private var time = 0.0
        private let textureOptions: [MTKTextureLoader.Option:Any] = [
            .origin: MTKTextureLoader.Origin.topLeft, .SRGB:false
        ]

        init(parent: MetalSurface) { self.parent = parent }

        func install(_ view: MTKView) {
            self.view = view
            view.delegate = self
            let arrival = UILongPressGestureRecognizer(target:self,action:#selector(stopInertia(_:)))
            arrival.minimumPressDuration = 0
            arrival.cancelsTouchesInView = false
            let pan = UIPanGestureRecognizer(target:self,action:#selector(pan(_:)))
            pan.maximumNumberOfTouches = 1
            let pinch = UIPinchGestureRecognizer(target:self,action:#selector(pinch(_:)))
            let tap = UITapGestureRecognizer(target:self,action:#selector(tap(_:)))
            let double = UITapGestureRecognizer(target:self,action:#selector(doubleTap(_:)))
            double.numberOfTapsRequired = 2
            tap.require(toFail:double)
            for gesture in [arrival,pan,pinch,tap,double] {
                gesture.delegate = self
                view.addGestureRecognizer(gesture)
            }
            view.accessibilityCustomActions = [
                UIAccessibilityCustomAction(name:"放大地球") { [weak self] _ in self?.stepZoom(1.35) ?? false },
                UIAccessibilityCustomAction(name:"缩小地球") { [weak self] _ in self?.stepZoom(1 / 1.35) ?? false },
            ]

            do {
                guard let device = view.device, let queue = device.makeCommandQueue() else { throw RendererError.unavailable }
                self.queue = queue
                let loader = MTKTextureLoader(device:device)
                self.loader = loader
                let dir = parent.resources
                let code = try String(contentsOf:dir.appendingPathComponent("Globe.metal.txt"),encoding:.utf8)
                let library = try device.makeLibrary(source:code,options:nil)
                let descriptor = MTLRenderPipelineDescriptor()
                descriptor.vertexFunction = library.makeFunction(name:"globeVertex")
                descriptor.fragmentFunction = library.makeFunction(name:"globeFragment")
                descriptor.colorAttachments[0].pixelFormat = view.colorPixelFormat
                pipeline = try device.makeRenderPipelineState(descriptor)
                earth = try loader.newTexture(URL:dir.appendingPathComponent("earth-detail.jpg"),options:textureOptions)
                clouds = try loader.newTexture(URL:dir.appendingPathComponent("clouds.png"),options:textureOptions)
                terrain = try loader.newTexture(URL:dir.appendingPathComponent("terrain-4k-v1.png"),options:textureOptions)
                let descriptor2D = MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.rgba8Unorm,width:1,height:1,mipmapped:false)
                descriptor2D.storageMode = .shared
                blank = device.makeTexture(descriptor:descriptor2D)
                var zero: UInt32 = 0
                blank?.replace(region:MTLRegionMake2D(0,0,1,1),mipmapLevel:0,withBytes:&zero,bytesPerRow:4)
            } catch {
                NSLog("Globe rendering initialization: %@",String(describing:error))
                DispatchQueue.main.async { self.parent.onError() }
            }
        }

        private enum RendererError: Error { case unavailable }

        func setOverlay(_ image: CGImage?) {
            guard overlayImage !== image else { return }
            overlayImage = image
            overlay = image.flatMap { try? loader?.newTexture(cgImage:$0,options:textureOptions) }
        }

        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) { view.setNeedsDisplay() }

        func draw(in view: MTKView) {
            guard parent.active, let pipeline, let earth, let clouds, let terrain, let boundaries = overlay ?? blank,
                  let drawable = view.currentDrawable, let pass = view.currentRenderPassDescriptor,
                  let commands = queue?.makeCommandBuffer(), let encoder = commands.makeRenderCommandEncoder(descriptor:pass)
            else { return }
            let camera = parent.camera, size = view.drawableSize, center = camera.center(in:size)
            let position = SIMD4<Float>(Float(center.x),Float(center.y),Float(camera.radius(in:size)),Float(camera.zoom))
            let rotation = SIMD4<Float>(Float(cos(camera.yaw)),Float(sin(camera.yaw)),
                                        Float(cos(camera.tilt)),Float(sin(camera.tilt)))
            let uniforms = [position,rotation]
            encoder.setRenderPipelineState(pipeline)
            uniforms.withUnsafeBytes { bytes in
                if let address = bytes.baseAddress { encoder.setFragmentBytes(address,length:bytes.count,index:0) }
            }
            encoder.setFragmentTexture(earth,index:0)
            encoder.setFragmentTexture(boundaries,index:1)
            encoder.setFragmentTexture(clouds,index:2)
            encoder.setFragmentTexture(terrain,index:3)
            encoder.drawPrimitives(type:.triangle,vertexStart:0,vertexCount:3)
            encoder.endEncoding()
            commands.present(drawable)
            commands.commit()
        }

        func gestureRecognizer(_ first: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith second: UIGestureRecognizer) -> Bool {
            first is UILongPressGestureRecognizer || second is UILongPressGestureRecognizer ||
                (first is UIPinchGestureRecognizer && second is UIPanGestureRecognizer) ||
                (first is UIPanGestureRecognizer && second is UIPinchGestureRecognizer)
        }

        @objc private func stopInertia(_ gesture: UILongPressGestureRecognizer) {
            if gesture.state == .began && displayLink != nil {
                cancelMotion()
                parent.onSettled(parent.camera)
            }
        }

        func cancelMotion() {
            displayLink?.invalidate()
            displayLink = nil
            time = 0
        }

        @objc private func pan(_ gesture: UIPanGestureRecognizer) {
            guard let view = gesture.view else { return }
            switch gesture.state {
            case .began:
                cancelMotion()
                gesture.setTranslation(.zero,in:view)
            case .changed:
                let delta = gesture.translation(in:view)
                gesture.setTranslation(.zero,in:view)
                guard pinchCenter == nil, gesture.numberOfTouches == 1 else { return }
                parent.camera.rotate(dx:Double(delta.x),dy:Double(delta.y),size:view.bounds.size)
            case .ended:
                guard pinchCenter == nil else { return }
                let speed = gesture.velocity(in:view)
                if !parent.reduceMotion && gesture.numberOfTouches == 0 && hypot(speed.x,speed.y) > 110 {
                    velocity = CGPoint(x:speed.x.clamped(to:-1150...1150),y:speed.y.clamped(to:-1150...1150))
                    let link = CADisplayLink(target:self,selector:#selector(coast(_:)))
                    displayLink = link
                    link.add(to:.main,forMode:.common)
                } else {
                    parent.onSettled(parent.camera)
                }
            case .cancelled, .failed:
                if pinchCenter == nil { parent.onSettled(parent.camera) }
            default: break
            }
        }

        @objc private func coast(_ link: CADisplayLink) {
            guard let view, view.window != nil, parent.active else { cancelMotion(); return }
            let dt = time == 0 ? 0.016 : (link.timestamp-time).clamped(to:0...0.035)
            time = link.timestamp
            let damp = exp(-dt * 7.2)
            velocity = CGPoint(x:velocity.x*damp,y:velocity.y*damp)
            parent.camera.rotate(dx:Double(velocity.x)*dt,dy:Double(velocity.y)*dt,size:view.bounds.size)
            if hypot(velocity.x,velocity.y) < 26 {
                cancelMotion()
                parent.onSettled(parent.camera)
            }
        }

        @objc private func pinch(_ gesture: UIPinchGestureRecognizer) {
            guard let view = gesture.view else { return }
            let current = gesture.location(in:view)
            switch gesture.state {
            case .began:
                cancelMotion()
                pinchCenter = current
                reachedLimit = false
                gesture.scale = 1
            case .changed:
                defer { gesture.scale = 1 }
                guard gesture.numberOfTouches == 2, let previous = pinchCenter else {
                    pinchCenter = current
                    return
                }
                let hit = parent.camera.magnify(Double(gesture.scale),from:previous,to:current,size:view.bounds.size)
                if hit && !reachedLimit { parent.onBoundary() }
                if hit { reachedLimit = true }
                if (0.9...6.95).contains(parent.camera.zoom) { reachedLimit = false }
                pinchCenter = current
            case .ended, .cancelled, .failed:
                pinchCenter = nil
                parent.onSettled(parent.camera)
            default: break
            }
        }

        @objc private func tap(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view else { return }
            parent.onTap(gesture.location(in:view),view.bounds.size)
        }

        @objc private func doubleTap(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view else { return }
            let wasNear = parent.camera.zoom <= 1.15
            if wasNear, let point = parent.camera.unproject(gesture.location(in:view),size:view.bounds.size) {
                parent.camera.center(longitude:Double(point.x)*0.36-180,latitude:90-Double(point.y)*0.36,zoom:2.4)
            } else {
                parent.camera.zoom = 1
                parent.camera.offsetX = 0
                parent.camera.offsetY = 0
            }
            parent.onSettled(parent.camera)
        }

        private func stepZoom(_ factor: Double) -> Bool {
            guard let view else { return false }
            let point = CGPoint(x:view.bounds.midX,y:view.bounds.midY)
            if parent.camera.magnify(factor,from:point,to:point,size:view.bounds.size) { parent.onBoundary() }
            parent.onSettled(parent.camera)
            return true
        }
    }
}
