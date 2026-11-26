import MetalKit
import UIKit
import UIKit.UIGestureRecognizerSubclass

private struct GlobeUniforms {
    var centerRadiusZoom: SIMD4<Float>
    var rotation: SIMD4<Float>
    var drawableSelectionScale: SIMD4<Float>
}

final class GlobeGPUAssets: @unchecked Sendable {
    private enum InitializationError: Error { case unavailable }
    private let queue: MTLCommandQueue
    private let globe: MTLRenderPipelineState
    private let boundary: MTLRenderPipelineState
    private let earth: MTLTexture
    private let terrain: MTLTexture
    private let clouds: MTLTexture
    private let blank: MTLTexture
    private let sampler: MTLSamplerState
    let device: MTLDevice
    let atlases: GPUAtlasCache
    private let frames = DispatchSemaphore(value:2)

    @MainActor private static var startup: [URL:Task<GlobeGPUAssets,Error>] = [:]

    @MainActor static func load(_ url: URL) async throws -> GlobeGPUAssets {
        if let work = startup[url] { return try await work.value }
        let work = Task.detached(priority:.userInitiated) { try GlobeGPUAssets(resources:url) }
        startup[url] = work
        do { return try await work.value }
        catch { startup[url] = nil; throw error }
    }

    private init(resources: URL) throws {
        guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
            throw InitializationError.unavailable
        }
        self.device = device
        self.queue = queue
        atlases = GPUAtlasCache(device:device)
        let code = try String(contentsOf:resources.appendingPathComponent("Globe.metal.txt"),encoding:.utf8)
        let library = try device.makeLibrary(source:code,options:nil)
        func pipeline(_ vertex: String, _ fragment: String, blended: Bool = false) throws -> MTLRenderPipelineState {
            let descriptor = MTLRenderPipelineDescriptor()
            descriptor.vertexFunction = library.makeFunction(name:vertex)
            descriptor.fragmentFunction = library.makeFunction(name:fragment)
            let color = descriptor.colorAttachments[0]!
            color.pixelFormat = .bgra8Unorm_srgb
            if blended {
                color.isBlendingEnabled = true
                color.sourceRGBBlendFactor = .one
                color.destinationRGBBlendFactor = .oneMinusSourceAlpha
                color.sourceAlphaBlendFactor = .one
                color.destinationAlphaBlendFactor = .oneMinusSourceAlpha
            }
            return try device.makeRenderPipelineState(descriptor:descriptor)
        }
        globe = try pipeline("globeVertex","globeFragment")
        boundary = try pipeline("boundaryVertex","boundaryFragment",blended:true)
        let loader = MTKTextureLoader(device:device)
        func texture(_ name: String, srgb: Bool) throws -> MTLTexture {
            try loader.newTexture(URL:resources.appendingPathComponent(name),
                                  options:[.origin:MTKTextureLoader.Origin.topLeft,.SRGB:srgb,.generateMipmaps:true])
        }
        earth = try texture("earth-detail.jpg",srgb:true)
        terrain = try texture("terrain-4k-v1.png",srgb:false)
        clouds = try texture("clouds.png",srgb:false)
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.rgba8Unorm,width:1,height:1,mipmapped:false)
        descriptor.storageMode = .shared
        let filter = MTLSamplerDescriptor()
        filter.normalizedCoordinates = true
        filter.sAddressMode = .repeat
        filter.tAddressMode = .clampToEdge
        filter.minFilter = .linear
        filter.magFilter = .linear
        filter.mipFilter = .linear
        filter.maxAnisotropy = 8
        guard let blank = device.makeTexture(descriptor:descriptor), let sampler = device.makeSamplerState(descriptor:filter) else {
            throw InitializationError.unavailable
        }
        var zero: UInt32 = 0
        blank.replace(region:MTLRegionMake2D(0,0,1,1),mipmapLevel:0,withBytes:&zero,bytesPerRow:4)
        self.blank = blank
        self.sampler = sampler
    }

    @MainActor func render(in view: MTKView, projection: GlobeProjection, zoom: Double,
                           map: GPUAtlas?, selected: Int, focused: [Int]) -> Bool {
        guard frames.wait(timeout:.now()) == .success else { return false }
        guard let pass = view.currentRenderPassDescriptor, let drawable = view.currentDrawable,
              let commands = queue.makeCommandBuffer(),
              let encoder = commands.makeRenderCommandEncoder(descriptor:pass) else {
            frames.signal()
            return false
        }
        let size = view.drawableSize
        let density = size.width/max(1,projection.size.width)
        var uniform = GlobeUniforms(
            centerRadiusZoom:SIMD4(Float(projection.origin.x*density),Float(projection.origin.y*density),
                                   Float(projection.radius*density),Float(zoom)),
            rotation:projection.rotation,
            drawableSelectionScale:SIMD4(Float(size.width),Float(size.height),Float(selected),Float(density))
        )
        var emphasis = SIMD4<Float>(repeating:0)
        for (index,id) in focused.prefix(4).enumerated() { emphasis[index] = Float(id) }
        encoder.setRenderPipelineState(globe)
        encoder.setFragmentBytes(&uniform,length:MemoryLayout<GlobeUniforms>.stride,index:0)
        for (index,texture) in [earth,map?.texture ?? blank,clouds,terrain].enumerated() {
            encoder.setFragmentTexture(texture,index:index)
        }
        encoder.setFragmentSamplerState(sampler,index:0)
        encoder.drawPrimitives(type:.triangle,vertexStart:0,vertexCount:3)
        if let map, let vertices = map.borders, map.count > 0 {
            encoder.setRenderPipelineState(boundary)
            encoder.setVertexBytes(&uniform,length:MemoryLayout<GlobeUniforms>.stride,index:0)
            encoder.setVertexBuffer(vertices,offset:0,index:1)
            encoder.setVertexBytes(&emphasis,length:MemoryLayout<SIMD4<Float>>.stride,index:2)
            encoder.drawPrimitives(type:.triangle,vertexStart:0,vertexCount:6,instanceCount:map.count)
        }
        encoder.endEncoding()
        commands.addCompletedHandler { [frames] _ in frames.signal() }
        commands.present(drawable)
        commands.commit()
        return true
    }
}

final class GPUAtlas: @unchecked Sendable {
    let texture: MTLTexture
    let borders: MTLBuffer?
    let count: Int

    init(texture: MTLTexture, borders: MTLBuffer?, count: Int) {
        self.texture = texture
        self.borders = borders
        self.count = count
    }
}

actor GPUAtlasCache {
    private enum UploadError: Error { case buffer }
    private let device: MTLDevice
    private var recent: [(UUID,GPUAtlas)] = []

    init(device: MTLDevice) { self.device = device }

    func load(_ map: PaintedAtlas) throws -> GPUAtlas {
        try Task.checkCancellation()
        if let index = recent.firstIndex(where:{ $0.0 == map.generation }) {
            let value = recent.remove(at:index)
            recent.append(value)
            return value.1
        }
        let loader = MTKTextureLoader(device:device)
        let texture = try loader.newTexture(cgImage:map.image,options:[
            .origin:MTKTextureLoader.Origin.topLeft,.SRGB:false,.generateMipmaps:true
        ])
        try Task.checkCancellation()
        let buffer = map.borders.withUnsafeBufferPointer { edges -> MTLBuffer? in
            guard let base = edges.baseAddress, !edges.isEmpty else { return nil }
            return device.makeBuffer(bytes:base,length:edges.count*MemoryLayout<BorderSegment>.stride,options:.storageModeShared)
        }
        if buffer == nil && !map.borders.isEmpty { throw UploadError.buffer }
        let value = GPUAtlas(texture:texture,borders:buffer,count:map.borders.count)
        recent.append((map.generation,value))
        if recent.count > 4 { recent.removeFirst() }
        return value
    }
}

@MainActor
final class GlobeSurface: UIView, MTKViewDelegate {
    struct Configuration {
        let viewport: GlobeViewport
        let assets: GlobeGPUAssets?
        let data: PaintedAtlas?
        let gpu: GPUAtlas?
        let marks: GlobeMarks
        let sceneKey: String?
        let selected: String?
        let showNames: Bool
        let active: Bool
        let reduced: Bool
        let interactive: Bool
        let allowsIdleRotation: Bool
        let boundaryFeedback: () -> Void
        let settled: (GlobeCamera) -> Void
        let regions: ([MapRegion]) -> Void
        let place: (String) -> Void
    }

    private struct Flight {
        let start: GlobeCamera
        let target: GlobeCamera
        let time: Double
        let duration: Double
    }

    private struct Frame {
        let camera: GlobeCamera
        let projection: GlobeProjection
        let aperture: CGRect
        let atlas: PaintedAtlas?
        let sceneKey: String?
    }

    private struct Contact {
        var point: CGPoint
        let initial: CGPoint
        let start: Double
    }

    private let metal = MTKView(frame:.zero)
    private lazy var annotations = GlobeAnnotations(in:metal.layer)
    private var configuration: Configuration?
    private var current = GlobeCamera()
    private var pinchProposal: GlobeCamera?
    private var idleSince: Double?
    private var idleWake: DispatchWorkItem?
    private var spinning = false
    private lazy var windowTouches = WindowTouches { [weak self] _ in self?.refreshIdle() }
    private var flight: Flight?
    private var velocity = CGPoint.zero
    private var motionTime = 0.0
    private var link: CADisplayLink?
    private var presented: Frame?
    private var redraw = false
    private var contacts: [ObjectIdentifier:Contact] = [:]
    private var touchOrder: [ObjectIdentifier] = []
    private var lastSample = 0.0
    private var didMove = false
    private var multiTouch = false
    private var limitFeedback = false
    private var pendingTap: DispatchWorkItem?
    private var lastTap: CGPoint?
    private var needsSettlement = false
    private var selectionID = 0
    private var focusIDs: [Int] = []

    override init(frame: CGRect) {
        super.init(frame:frame)
        backgroundColor = UIColor(red:0.039,green:0.063,blue:0.086,alpha:1)
        metal.isPaused = true
        metal.enableSetNeedsDisplay = false
        metal.colorPixelFormat = .bgra8Unorm_srgb
        (metal.layer as? CAMetalLayer)?.colorspace = CGColorSpace(name:CGColorSpace.sRGB)
        metal.isUserInteractionEnabled = false
        metal.delegate = self
        addSubview(metal)
        isMultipleTouchEnabled = true
        clipsToBounds = true
        isAccessibilityElement = true
        accessibilityLabel = "历史地球"
        accessibilityIdentifier = "history-globe"
        accessibilityHint = "拖动旋转，双指缩放。"
        accessibilityCustomActions = [
            UIAccessibilityCustomAction(name:"放大地球") { [weak self] _ in self?.zoom(1.35) ?? false },
            UIAccessibilityCustomAction(name:"缩小地球") { [weak self] _ in self?.zoom(1/1.35) ?? false },
            UIAccessibilityCustomAction(name:"复位视角") { [weak self] _ in
                guard let self else { return false }
                self.move(to:GlobeCamera(),animated:true)
                return true
            }
        ]
    }

    required init?(coder: NSCoder) { nil }

    func configure(_ value: Configuration) {
        let previous = configuration
        configuration = value
        if previous?.viewport !== value.viewport {
            previous?.viewport.onChange = nil
            previous?.viewport.onIdleChange = nil
            interruptIdle()
            current = value.viewport.camera
            value.viewport.onIdleChange = { [weak self] in self?.refreshIdle() }
            value.viewport.onChange = { [weak self] target,animated in
                guard let self else { return }
                if let target { self.move(to:target,animated:animated) }
                else { self.requestFrame() }
            }
        }
        if metal.device == nil { metal.device = value.assets?.device }
        let sceneChanged = previous == nil || previous?.sceneKey != value.sceneKey ||
            previous?.marks.geometryKey != value.marks.geometryKey
        let dataChanged = previous?.data?.generation != value.data?.generation
        if dataChanged || sceneChanged || previous?.selected != value.selected || previous?.showNames != value.showNames {
            annotations.invalidate()
            selectionID = value.selected.flatMap { value.data?.regionIDs[$0] } ?? 0
            focusIDs = value.marks.focusPolities.compactMap {
                let id = $0.hasPrefix("polity:") ? $0 : "polity:" + $0
                return value.data?.regionIDs[id]
            }
        }
        annotations.use(map:value.data,marks:value.marks,sceneChanged:sceneChanged)
        if !value.active { suspend(); return }
        if previous?.interactive == true && !value.interactive {
            pendingTap?.cancel()
            pendingTap = nil
            lastTap = nil
        }
        observeTouches()
        refreshIdle()
        requestFrame()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        metal.frame = bounds
        refreshIdle()
        requestFrame()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        observeTouches()
        if window != nil {
            refreshIdle()
            requestFrame()
        } else { suspend() }
    }

    func detach() {
        suspend()
        configuration?.viewport.onChange = nil
        configuration?.viewport.onIdleChange = nil
        configuration = nil
        interruptIdle()
        observeTouches()
        link?.invalidate()
        link = nil
    }

    private func suspend() {
        interruptIdle()
        flight = nil
        velocity = .zero
        contacts.removeAll()
        touchOrder.removeAll()
        pinchProposal = nil
        configuration?.viewport.setMapTouch(false)
        pendingTap?.cancel()
        pendingTap = nil
        lastTap = nil
        if let viewport = configuration?.viewport { current = viewport.limit(current,in:bounds.size) }
        finishMotion()
        link?.isPaused = true
    }

    private var maySpin: Bool {
        guard let config = configuration, config.active, config.interactive, config.allowsIdleRotation,
              !config.reduced, config.viewport.permitsIdle, config.assets != nil, window != nil,
              current.isGlobal, contacts.isEmpty, !windowTouches.isDown,
              flight == nil, velocity == .zero, pendingTap == nil else { return false }
        return config.viewport.aperture(in:bounds.size).height > 32
    }

    private func observeTouches() {
        let target = configuration?.allowsIdleRotation == true ? window : nil
        guard windowTouches.view !== target else { return }
        windowTouches.view?.removeGestureRecognizer(windowTouches)
        if let target { target.addGestureRecognizer(windowTouches) }
    }

    private func interruptIdle() {
        idleSince = nil
        idleWake?.cancel()
        idleWake = nil
        if spinning {
            spinning = false
            updateFrameRate()
            let camera = current.normalized()
            configuration?.viewport.present(camera)
        }
    }

    private func refreshIdle() {
        guard maySpin else { interruptIdle(); return }
        guard idleSince == nil else { return }
        let since = CACurrentMediaTime()
        idleSince = since
        let wake = DispatchWorkItem { [weak self] in
            guard let self, self.idleSince == since, self.maySpin else { return }
            self.idleWake = nil
            self.requestFrame()
        }
        idleWake = wake
        DispatchQueue.main.asyncAfter(deadline:.now()+GlobeIdleMotion.delay,execute:wake)
    }

    private func updateFrameRate() {
        let upper = Float(window?.screen.maximumFramesPerSecond ?? 60)
        let preferred = min(spinning ? 30 : upper,upper)
        link?.preferredFrameRateRange = CAFrameRateRange(minimum:min(preferred,60),
                                                         maximum:spinning ? preferred : upper,preferred:preferred)
    }

    private func requestFrame() {
        redraw = true
        guard configuration?.active == true, window != nil else { return }
        if link == nil {
            let newLink = CADisplayLink(target:self,selector:#selector(tick(_:)))
            link = newLink
            updateFrameRate()
            newLink.add(to:.main,forMode:.common)
        }
        link?.isPaused = false
    }

    @objc private func tick(_ sender: CADisplayLink) {
        let elapsed = min(0.045,max(0.001,sender.timestamp-motionTime))
        motionTime = sender.timestamp
        if let flight {
            let u = ((sender.targetTimestamp-flight.time)/flight.duration).clamped(to:0...1)
            let ease = u*u*(3-2*u)
            current = interpolate(flight.start,flight.target,progress:ease)
            if u == 1 { self.flight = nil; current = flight.target; finishMotion() }
            redraw = true
        } else if velocity != .zero, contacts.isEmpty {
            current.rotate(dx:velocity.x*elapsed,dy:velocity.y*elapsed,size:bounds.size)
            let decay = exp(-elapsed*5.6)
            velocity = CGPoint(x:velocity.x*decay,y:velocity.y*decay)
            if hypot(velocity.x,velocity.y) < 12 { velocity = .zero; finishMotion() }
            redraw = true
        }
        if let since = idleSince, sender.targetTimestamp-since >= GlobeIdleMotion.delay, maySpin {
            if !spinning { spinning = true; updateFrameRate() }
            current.yaw = (current.yaw + GlobeIdleMotion.yawDelta(elapsed:elapsed,eligibleFor:sender.targetTimestamp-since))
                .truncatingRemainder(dividingBy:2 * .pi)
            redraw = true
        }
        if redraw {
            redraw = false
            metal.draw()
        }
        if !redraw && flight == nil && velocity == .zero && !spinning { sender.isPaused = true }
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) { requestFrame() }

    func draw(in view: MTKView) {
        guard let config = configuration, config.active, let assets = config.assets, bounds.width > 0, bounds.height > 0 else { return }
        let size = bounds.size
        let camera = config.viewport.display(current,in:size)
        let projection = GlobeProjection(camera:camera,size:size)
        let aperture = config.viewport.aperture(in:size)
        guard aperture.height > 32 else {
            annotations.render(projection,aperture:.zero,camera:camera,selected:config.selected,
                               showNames:config.showNames,screenScale:contentScaleFactor,time:CACurrentMediaTime(),reduced:config.reduced)
            presented = nil
            return
        }
        guard assets.render(in:view,projection:projection,zoom:camera.zoom,map:config.gpu,
                            selected:selectionID,focused:focusIDs) else { redraw = true; return }
        annotations.render(projection,aperture:aperture,camera:camera,selected:config.selected,
                           showNames:config.showNames,screenScale:window?.screen.scale ?? contentScaleFactor,
                           time:CACurrentMediaTime(),reduced:config.reduced)
        presented = Frame(camera:camera,projection:projection,aperture:aperture,atlas:config.data,sceneKey:config.sceneKey)
    }

    private func move(to proposed: GlobeCamera, animated: Bool, duration: Double = 0.39) {
        interruptIdle()
        let target = (configuration?.viewport.limit(proposed,in:bounds.size) ?? proposed).normalized()
        velocity = .zero
        needsSettlement = true
        if animated && configuration?.reduced != true && window != nil {
            flight = Flight(start:current,target:target,time:CACurrentMediaTime(),duration:duration)
        } else {
            flight = nil
            current = target
            finishMotion()
        }
        requestFrame()
    }

    private func interpolate(_ a: GlobeCamera, _ b: GlobeCamera, progress: Double) -> GlobeCamera {
        var result = a
        func mix(_ start: Double,_ end: Double) -> Double { start+(end-start)*progress }
        let yaw = atan2(sin(b.yaw-a.yaw),cos(b.yaw-a.yaw))
        result.yaw = a.yaw + yaw*progress
        result.tilt = mix(a.tilt,b.tilt)
        result.zoom = a.zoom * pow(b.zoom/a.zoom,progress)
        result.offsetX = mix(a.offsetX,b.offsetX)
        result.offsetY = mix(a.offsetY,b.offsetY)
        result.verticalCenter = mix(a.verticalCenter,b.verticalCenter)
        return result
    }

    private func finishMotion() {
        if needsSettlement {
            needsSettlement = false
            let stable = (configuration?.viewport.limit(current,in:bounds.size) ?? current).normalized()
            configuration?.viewport.present(stable)
            configuration?.settled(stable)
        }
        refreshIdle()
    }

    private func settleAfterContact() {
        guard let viewport = configuration?.viewport else { return }
        let target = viewport.limit(current,in:bounds.size)
        if target.offsetX != current.offsetX || target.offsetY != current.offsetY {
            move(to:target,animated:true,duration:0.27)
        } else { finishMotion() }
    }

    private func stabilize() {
        if flight != nil || velocity != .zero {
            flight = nil
            velocity = .zero
        }
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        interruptIdle()
        stabilize()
        if contacts.isEmpty {
            configuration?.viewport.setMapTouch(true)
            didMove = false
            multiTouch = false
            limitFeedback = false
        }
        for touch in touches {
            let id = ObjectIdentifier(touch), point = touch.location(in:self)
            contacts[id] = Contact(point:point,initial:point,start:touch.timestamp)
            touchOrder.append(id)
        }
        if contacts.count > 1 { multiTouch = true; clearTap() }
        updateTouchBaseline(event)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let config = configuration else { return }
        let ids = touchOrder.prefix(2)
        let before = ids.compactMap { contacts[$0]?.point }
        for touch in touches {
            let id = ObjectIdentifier(touch)
            guard var contact = contacts[id] else { continue }
            contact.point = touch.location(in:self)
            if hypot(contact.point.x-contact.initial.x,contact.point.y-contact.initial.y) > 5 { didMove = true }
            contacts[id] = contact
        }
        let after = ids.compactMap { contacts[$0]?.point }
        let time = event?.timestamp ?? CACurrentMediaTime()
        let delta = max(0.004,time-lastSample)
        defer { lastSample = time }
        if didMove { clearTap() }
        if after.count == 1, before.count == 1 {
            let dx = after[0].x-before[0].x, dy = after[0].y-before[0].y
            guard abs(dx)+abs(dy) > 0.01 else { return }
            current.rotate(dx:dx,dy:dy,size:bounds.size)
            velocity = CGPoint(x:(velocity.x*0.55+dx/delta*0.45).clamped(to:-1800...1800),
                               y:(velocity.y*0.55+dy/delta*0.45).clamped(to:-1800...1800))
        } else if after.count == 2, before.count == 2, contacts.count == 2 {
            let previous = midpoint(before), next = midpoint(after)
            let distance = hypot(before[0].x-before[1].x,before[0].y-before[1].y)
            let changed = hypot(after[0].x-after[1].x,after[0].y-after[1].y)
            guard changed > 3, distance > 3 else { return }
            var camera = config.viewport.display(pinchProposal ?? current,in:bounds.size)
            let limited = camera.magnify(changed/distance,from:previous,to:next,size:bounds.size)
            camera.verticalCenter = current.verticalCenter
            pinchProposal = camera
            current = config.viewport.limit(camera,in:bounds.size,elastic:true)
            if limited && !limitFeedback { config.boundaryFeedback() }
            limitFeedback = limited
            velocity = .zero
        } else { return }
        needsSettlement = true
        requestFrame()
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        let time = event?.timestamp ?? CACurrentMediaTime()
        if contacts.count == 1, !didMove, !multiTouch,
           let touch = touches.first, let contact = contacts[ObjectIdentifier(touch)], time-contact.start < 0.35 {
            registerTap(touch.location(in:self))
        }
        remove(touches)
        if contacts.isEmpty {
            configuration?.viewport.setMapTouch(false)
            if time-lastSample > 0.095 || multiTouch || !didMove || configuration?.reduced == true { velocity = .zero }
            pinchProposal = nil
            if velocity == .zero { settleAfterContact() }
            else { motionTime = CACurrentMediaTime(); requestFrame() }
        } else {
            updateTouchBaseline(event)
        }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        remove(touches)
        if contacts.isEmpty { configuration?.viewport.setMapTouch(false) }
        multiTouch = true
        clearTap()
        updateTouchBaseline(event)
        if contacts.isEmpty { settleAfterContact() }
    }

    private func updateTouchBaseline(_ event: UIEvent?) {
        lastSample = event?.timestamp ?? CACurrentMediaTime()
        pinchProposal = nil
        velocity = .zero
    }

    private func remove(_ touches: Set<UITouch>) {
        for touch in touches {
            let id = ObjectIdentifier(touch)
            contacts.removeValue(forKey:id)
            touchOrder.removeAll { $0 == id }
        }
    }

    private func midpoint(_ points: [CGPoint]) -> CGPoint {
        CGPoint(x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2)
    }

    private func clearTap() {
        pendingTap?.cancel()
        pendingTap = nil
        lastTap = nil
    }

    private func registerTap(_ point: CGPoint) {
        if let previous = lastTap, hypot(previous.x-point.x,previous.y-point.y) < 36 {
            clearTap()
            guard let frame = presented else { return }
            if current.zoom >= 4.7 || frame.camera.unproject(point,size:bounds.size) == nil {
                move(to:GlobeCamera(),animated:true)
            } else if let geographic = frame.camera.unproject(point,size:bounds.size) {
                var camera = current
                camera.center(longitude:geographic.x*0.36-180,latitude:90-geographic.y*0.36,zoom:camera.zoom*1.76)
                move(to:camera,animated:true)
            }
            return
        }
        clearTap()
        lastTap = point
        let tap = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.lastTap = nil
            self.pendingTap = nil
            self.pick(point)
            self.refreshIdle()
        }
        pendingTap = tap
        DispatchQueue.main.asyncAfter(deadline:.now()+0.23,execute:tap)
    }

    private func pick(_ point: CGPoint) {
        guard let config = configuration, config.interactive, let frame = presented,
              frame.atlas?.generation == config.data?.generation, frame.sceneKey == config.sceneKey,
              frame.aperture.contains(point) else { return }
        let coordinate = frame.camera.unproject(point,size:frame.projection.size)
        let overlaps = coordinate.flatMap { frame.atlas?.picks(at:$0) } ?? []
        if let hit = annotations.hit(point) {
            if hit.place { config.place(hit.id); return }
            if let region = frame.atlas?.shapes.first(where:{ $0.region.id == hit.id })?.region {
                config.regions([region] + overlaps.filter { $0.id != region.id })
                return
            }
        }
        config.regions(overlaps)
    }

    private func zoom(_ change: Double) -> Bool {
        var target = current
        let size = bounds.size
        let origin = target.center(in:size)
        if target.magnify(change,from:origin,to:origin,size:size) { configuration?.boundaryFeedback() }
        move(to:target,animated:true)
        return true
    }
}

/// Watches touches anywhere in the window without winning a gesture or cancelling a control.
private final class WindowTouches: UIGestureRecognizer {
    private var count = 0
    private let changed: (Bool) -> Void

    var isDown: Bool { count > 0 }

    init(changed: @escaping (Bool) -> Void) {
        self.changed = changed
        super.init(target:nil,action:nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
    }

    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        let first = count == 0
        count += touches.count
        if first { changed(true) }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { end(touches.count) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { end(touches.count) }

    override func reset() {
        if count > 0 { count = 0; changed(false) }
        super.reset()
    }

    private func end(_ removed: Int) {
        guard count > 0 else { return }
        count = max(0,count-removed)
        if count == 0 {
            state = .failed
            changed(false)
        }
    }
}
