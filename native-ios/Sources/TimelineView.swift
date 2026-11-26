import SwiftUI
import UIKit

struct HistoryTimeline: UIViewRepresentable {
    let year: Int
    let scale: TimelineScale
    let eventIndices: [Int]
    let haptics: Bool
    let reduceMotion: Bool
    let active: Bool
    let allowsTouch: () -> Bool
    let onTracking: (Bool) -> Void
    let onPreview: (Int) -> Void
    let onCancel: () -> Void
    let onCommit: (Int) -> Void
    let onScale: (TimelineScale) -> Void
    let onChooseYear: () -> Void

    func makeUIView(context: Context) -> TimelineControl { TimelineControl() }
    func updateUIView(_ view: TimelineControl, context: Context) { view.configure(self) }
    static func dismantleUIView(_ view: TimelineControl, coordinator: ()) { view.detach() }
}

/// The date at the cursor lives in chronological index space. Scale controls only its projection.
@MainActor
final class TimelineControl: UIView {
    private enum Gesture { case waiting, drag, pinch, resumeDrag, ignored }
    private struct Zoom {
        let distance: CGFloat
        let step: Double
    }
    private struct Snap {
        let start: Double
        let end: Double
        let began: CFTimeInterval
    }
    private struct Tick {
        let index: Int
        let x: CGFloat
        let label: Bool
    }
    private final class FrameTarget: NSObject {
        weak var view: TimelineControl?
        @objc func tick(_ link: CADisplayLink) { view?.tick(link) }
    }

    private var input: HistoryTimeline?
    private var position = TimelinePosition(year:1500)
    private var committedYear = 1500
    private var displayedYear = 1500
    private var selectedScale = TimelineScale.year
    private var step = 1.0
    private var mode: Gesture = .waiting
    private var contacts: [ObjectIdentifier:CGPoint] = [:]
    private var order: [ObjectIdentifier] = []
    private var touchOrigin = CGPoint.zero
    private var zoom: Zoom?
    private var snap: Snap?
    private var hold: DispatchWorkItem?
    private var velocity = 0.0
    private var sampleTime = 0.0
    private var frameTime = 0.0
    private var feedbackTime = 0.0
    private var coasting = false
    private var tracking = false
    private var hasPreview = false
    private var link: CADisplayLink?
    private let labels: [NSAttributedString.Key:Any] = [
        .font:UIFont.monospacedDigitSystemFont(ofSize:10,weight:.regular),
        .foregroundColor:UIColor(white:0.89,alpha:1)
    ]

    override init(frame: CGRect) {
        super.init(frame:frame)
        backgroundColor = .clear
        isOpaque = false
        isMultipleTouchEnabled = true
        contentMode = .redraw
        isAccessibilityElement = true
        accessibilityLabel = "历史时间轴"
        accessibilityIdentifier = "timeline-ruler"
        accessibilityTraits = .adjustable
        accessibilityHint = "上下轻扫调整年份，使用操作可以打开精确选年。"
        accessibilityCustomActions = [
            UIAccessibilityCustomAction(name:"精确选年") { [weak self] _ in
                guard let self, self.input?.active == true else { return false }
                self.openYearChooser()
                return true
            },
            UIAccessibilityCustomAction(name:"前进一年") { [weak self] _ in self?.accessibilityStep(1) ?? false },
            UIAccessibilityCustomAction(name:"后退一年") { [weak self] _ in self?.accessibilityStep(-1) ?? false }
        ]
        NotificationCenter.default.addObserver(self,selector:#selector(interrupt),name:UIApplication.willResignActiveNotification,object:nil)
    }

    required init?(coder: NSCoder) { nil }

    func configure(_ next: HistoryTimeline) {
        let previous = input
        input = next
        isUserInteractionEnabled = next.active
        if previous == nil || previous?.year != next.year {
            committedYear = next.year
            if !tracking || !next.active {
                position = TimelinePosition(year:next.year)
                displayedYear = next.year
            }
        }
        if previous == nil {
            selectedScale = next.scale
            step = Double(next.scale.rawValue)
        } else if selectedScale != next.scale {
            selectedScale = next.scale
            animateScale(to:next.scale)
        }
        if !next.active && previous?.active != false { resetInput(notify:false) }
        updateAccessibility()
        setNeedsDisplay()
    }

    func detach() {
        NotificationCenter.default.removeObserver(self)
        resetInput(notify:false)
        input = nil
        link?.invalidate()
        link = nil
    }

    @objc private func interrupt() { resetInput(notify:true) }

    private func setTracking(_ value: Bool) {
        guard tracking != value else { return }
        tracking = value
        input?.onTracking(value)
    }

    private func resetInput(notify: Bool, clearContacts: Bool = true) {
        hold?.cancel()
        hold = nil
        velocity = 0
        coasting = false
        zoom = nil
        if clearContacts { contacts.removeAll(); order.removeAll() }
        mode = .ignored
        snap = nil
        step = Double(selectedScale.rawValue)
        position = TimelinePosition(year:committedYear)
        displayedYear = committedYear
        if hasPreview && notify { input?.onCancel() }
        hasPreview = false
        setTracking(false)
        link?.isPaused = true
        updateAccessibility()
        setNeedsDisplay()
    }

    private func commit(_ year: Int, feedback: Bool = false) {
        let changed = committedYear != year
        let finishPreview = hasPreview
        committedYear = year
        displayedYear = year
        position = TimelinePosition(year:year)
        hasPreview = false
        updateAccessibility()
        setNeedsDisplay()
        if feedback, changed, input?.haptics == true { GlobeHaptics.selection() }
        if changed || finishPreview { input?.onCommit(year) }
    }

    private func publishPreview(at now: Double) {
        let year = position.year
        guard displayedYear != year else { return }
        displayedYear = year
        hasPreview = true
        input?.onPreview(year)
        updateAccessibility()
        if input?.haptics == true, now-feedbackTime > 0.085 {
            let boundary = year == Chronology.first || year == Chronology.latest
            if boundary { GlobeHaptics.boundary() }
            else if selectedScale == .year || year.isMultiple(of:selectedScale.rawValue) { GlobeHaptics.selection() }
            feedbackTime = now
        }
    }

    private func openYearChooser() {
        resetInput(notify:true,clearContacts:false)
        input?.onChooseYear()
    }

    private func updateAccessibility() {
        accessibilityValue = "\(eraYear(displayedYear)) 年，\(selectedScale.label)"
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let input, input.active, input.allowsTouch(),
              mode != .ignored || contacts.isEmpty else { return }
        let starting = contacts.isEmpty
        for touch in touches {
            let id = ObjectIdentifier(touch)
            contacts[id] = touch.location(in:self)
            order.append(id)
        }
        coasting = false
        velocity = 0
        snap = nil
        sampleTime = event?.timestamp ?? CACurrentMediaTime()
        if starting {
            setTracking(true)
            touchOrigin = order.first.flatMap { contacts[$0] } ?? .zero
            mode = .waiting
            if input.haptics { GlobeHaptics.prepareSelection() }
        }
        hold?.cancel()
        hold = nil
        if contacts.count == 2 {
            beginPinch()
        } else if starting && contacts.count == 1 {
            let hold = DispatchWorkItem { [weak self] in
                guard let self, self.mode == .waiting, self.contacts.count == 1,
                      self.input?.allowsTouch() == true else { return }
                self.openYearChooser()
            }
            self.hold = hold
            DispatchQueue.main.asyncAfter(deadline:.now()+0.43,execute:hold)
        } else {
            // Keep the current axis when an extra finger lands. Establish a fresh baseline on return to two.
            if mode != .pinch { commit(position.year) }
            mode = .pinch
            zoom = nil
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard mode != .ignored, let input else { return }
        guard input.active && input.allowsTouch() else { resetInput(notify:true,clearContacts:false); return }
        let before = order.first.flatMap { contacts[$0] }
        for touch in touches where contacts[ObjectIdentifier(touch)] != nil {
            contacts[ObjectIdentifier(touch)] = touch.location(in:self)
        }
        let now = event?.timestamp ?? CACurrentMediaTime()
        let elapsed = max(0.004,now-sampleTime)
        defer { sampleTime = now }
        if contacts.count == 2, let zoom, let distance = pinchDistance {
            step = TimelineScale.zoomedStep(zoom.step,by:Double(distance/zoom.distance))
            setNeedsDisplay()
        } else if contacts.count == 1, let before, let id = order.first, let after = contacts[id] {
            if mode == .resumeDrag {
                guard hypot(after.x-touchOrigin.x,after.y-touchOrigin.y) > 6 else { return }
                mode = .drag
                return
            } else if mode == .waiting && hypot(after.x-touchOrigin.x,after.y-touchOrigin.y) > 6 {
                hold?.cancel()
                hold = nil
                mode = .drag
                position.drag(points:after.x-touchOrigin.x,step:step)
            } else if mode == .drag {
                position.drag(points:after.x-before.x,step:step)
            } else { return }
            let dx = Double(after.x-before.x)
            velocity = (velocity*0.48 + dx/elapsed*0.52).clamped(to:-3100...3100)
            publishPreview(at:now)
            setNeedsDisplay()
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        let tap = touches.first?.location(in:self)
        for touch in touches {
            let id = ObjectIdentifier(touch)
            contacts.removeValue(forKey:id)
            order.removeAll { $0 == id }
        }
        hold?.cancel()
        hold = nil
        guard mode != .ignored else { return }
        guard input?.allowsTouch() == true else { resetInput(notify:true,clearContacts:false); return }
        if contacts.count == 2 {
            beginPinch()
            return
        }
        if contacts.count == 1 && mode == .pinch {
            finishPinch()
            mode = .resumeDrag
            touchOrigin = order.first.flatMap { contacts[$0] } ?? .zero
            velocity = 0
            sampleTime = event?.timestamp ?? CACurrentMediaTime()
            return
        }
        guard contacts.isEmpty else { return }
        let now = event?.timestamp ?? CACurrentMediaTime()
        switch mode {
        case .waiting:
            if let tap, let tick = nearestTick(at:tap.x) { commit(Chronology.year(tick.index),feedback:true) }
            else { commit(position.year) }
        case .drag:
            if input?.reduceMotion != true, now-sampleTime < 0.105, abs(velocity) > 140 {
                coasting = true
                frameTime = CACurrentMediaTime()
                ensureFrame()
                return
            }
            commit(position.year)
        case .pinch:
            finishPinch()
        case .resumeDrag, .ignored:
            break
        }
        if step != Double(selectedScale.rawValue) && snap == nil { animateScale(to:selectedScale) }
        setTracking(snap != nil)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        resetInput(notify:true)
    }

    private var pinchDistance: CGFloat? {
        guard order.count == 2, let a = contacts[order[0]], let b = contacts[order[1]] else { return nil }
        return max(10,hypot(a.x-b.x,a.y-b.y))
    }

    private func beginPinch() {
        mode = .pinch
        velocity = 0
        // If a drag fed a visible preview into the cursor, keep that exact year as the zoom anchor.
        commit(position.year)
        zoom = pinchDistance.map { Zoom(distance:$0,step:step) }
    }

    private func finishPinch() {
        zoom = nil
        let next = TimelineScale.nearest(to:step)
        if next != selectedScale {
            selectedScale = next
            input?.onScale(next)
            if input?.haptics == true { GlobeHaptics.selection() }
        }
        animateScale(to:next)
        updateAccessibility()
    }

    private func animateScale(to target: TimelineScale) {
        let value = Double(target.rawValue)
        if input?.reduceMotion == true || abs(step-value) < 0.01 {
            step = value
            snap = nil
            setNeedsDisplay()
        } else {
            snap = Snap(start:step,end:value,began:CACurrentMediaTime())
            if input?.active == true { setTracking(true) }
            ensureFrame()
        }
    }

    private func ensureFrame() {
        if link == nil {
            let target = FrameTarget()
            target.view = self
            let display = CADisplayLink(target:target,selector:#selector(FrameTarget.tick(_:)))
            display.add(to:.main,forMode:.common)
            link = display
        }
        link?.isPaused = false
    }

    private func tick(_ display: CADisplayLink) {
        if coasting {
            guard input?.active == true, input?.allowsTouch() == true else { resetInput(notify:true); return }
            let dt = min(0.045,max(0,display.timestamp-frameTime))
            frameTime = display.timestamp
            let before = position.center
            position.drag(points:velocity*dt,step:step)
            velocity *= exp(-dt*4.8)
            publishPreview(at:display.timestamp)
            if abs(velocity) < 23 || (dt > 0 && position.center == before) {
                coasting = false
                commit(position.year)
                if snap == nil && step != Double(selectedScale.rawValue) { animateScale(to:selectedScale) }
            }
        }
        if let snap {
            let fraction = ((CACurrentMediaTime()-snap.began)/0.24).clamped(to:0...1)
            let ease = 1-pow(1-fraction,3)
            step = snap.start * pow(snap.end/snap.start,ease)
            if fraction >= 1 { step = snap.end; self.snap = nil }
        }
        setNeedsDisplay()
        if !coasting && snap == nil {
            if contacts.isEmpty { setTracking(false) }
            display.isPaused = true
        }
    }

    private func accessibilityStep(_ amount: Int) -> Bool {
        guard input?.active == true else { return false }
        resetInput(notify:true)
        commit(Chronology.offset(committedYear,amount),feedback:true)
        return true
    }

    override func accessibilityIncrement() { _ = accessibilityStep(selectedScale.rawValue) }
    override func accessibilityDecrement() { _ = accessibilityStep(-selectedScale.rawValue) }

    private var pointsPerYear: Double { TimelinePosition.tickSpacing / step }
    private func x(_ index: Double) -> CGFloat { bounds.midX + (index-position.center)*pointsPerYear }

    private func ticks(for scale: TimelineScale) -> [Tick] {
        guard bounds.width > 0 else { return [] }
        let unit = scale.rawValue
        let screenSpan = Double(bounds.width/2+12)/pointsPerYear
        let indices = position.bounds
        let minIndex = Int(max(indices.lowerBound,ceil(position.center-screenSpan)))
        let maxIndex = Int(min(indices.upperBound,floor(position.center+screenSpan)))
        guard minIndex <= maxIndex else { return [] }
        let firstYear = Chronology.year(minIndex)
        let lastYear = Chronology.year(maxIndex)
        let labelEvery = max(5,Int(ceil(55/max(1,Double(unit)*pointsPerYear))))
        let initial = Int(ceil(Double(firstYear)/Double(unit)))*unit
        guard initial <= lastYear else { return [] }
        return stride(from:initial,through:lastYear,by:unit).compactMap { year in
            guard year != 0 else {
                guard minIndex <= 0, maxIndex >= 0, unit > 1 else { return nil }
                return Tick(index:0,x:x(0),label:false)
            }
            let index = Chronology.index(year)
            return Tick(index:index,x:x(Double(index)),label:(year/unit).isMultiple(of:labelEvery))
        }
    }

    private func nearestTick(at location: CGFloat) -> Tick? {
        let scale = TimelineScale.nearest(to:step)
        guard let tick = ticks(for:scale).min(by:{ abs($0.x-location) < abs($1.x-location) }),
              abs(tick.x-location) <= min(10,Double(scale.rawValue)*pointsPerYear/2) else { return nil }
        return tick
    }

    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext(), bounds.width > 0 else { return }
        let levels = TimelineScale.allCases
        let lower = levels.last { Double($0.rawValue) <= step } ?? .year
        let higher = levels.first { Double($0.rawValue) > step } ?? lower
        let span = log(Double(higher.rawValue)/Double(lower.rawValue))
        let blend = span > 0 ? (log(step/Double(lower.rawValue))/span).clamped(to:0...1) : 0
        drawTicks(lower,alpha:1-blend,in:ctx)
        if blend > 0.001 { drawTicks(higher,alpha:blend,in:ctx) }
        drawEvents(in:ctx)
        ctx.setStrokeColor(UIColor(red:0.82,green:0.37,blue:0.27,alpha:1).cgColor)
        ctx.setLineWidth(2)
        ctx.move(to:CGPoint(x:bounds.midX,y:5))
        ctx.addLine(to:CGPoint(x:bounds.midX,y:36))
        ctx.strokePath()
    }

    private func drawTicks(_ scale: TimelineScale, alpha: Double, in ctx: CGContext) {
        guard alpha > 0.001 else { return }
        let spacing = Double(scale.rawValue)*pointsPerYear
        let visibility = ((spacing-4)/6).clamped(to:0...1)*alpha
        guard visibility > 0.001 else { return }
        ctx.saveGState()
        ctx.setAlpha(visibility)
        ctx.setLineWidth(1)
        for tick in ticks(for:scale) {
            ctx.setStrokeColor(UIColor(white:0.87,alpha:tick.label ? 0.57 : 0.28).cgColor)
            ctx.move(to:CGPoint(x:tick.x,y:tick.label ? 13 : 21))
            ctx.addLine(to:CGPoint(x:tick.x,y:35))
            ctx.strokePath()
            if tick.label {
                let text = NSAttributedString(string:eraYear(Chronology.year(tick.index)),attributes:labels)
                text.draw(at:CGPoint(x:tick.x-text.size().width/2,y:38))
            }
        }
        ctx.restoreGState()
    }

    private func drawEvents(in ctx: CGContext) {
        guard let indices = input?.eventIndices else { return }
        // Bin in chronological space so clusters pan naturally with the scale.
        let yearsPerBin = max(1,ceil(13/pointsPerYear))
        var total = 0
        var center: Double?
        func dot() {
            guard let center, total > 0 else { return }
            let cx = x(center)
            let radius: CGFloat = total == 1 ? 1.65 : (total < 6 ? 2.25 : 3)
            ctx.fillEllipse(in:CGRect(x:cx-radius,y:8-radius,width:2*radius,height:2*radius))
        }
        ctx.setFillColor(UIColor(red:0.86,green:0.73,blue:0.49,alpha:0.9).cgColor)
        for index in indices {
            let bin = (Double(index)/yearsPerBin).rounded()*yearsPerBin
            let point = x(bin)
            if point < -6 { continue }
            if point > bounds.width+6 { break }
            if center != bin {
                dot()
                total = 0
                center = bin
            }
            total += 1
        }
        dot()
    }
}
