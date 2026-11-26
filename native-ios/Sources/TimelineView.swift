import SwiftUI
import UIKit

struct HistoryTimeline: UIViewRepresentable {
    let year: Int
    let scale: TimelineScale
    let hasEvent: (Int) -> Bool
    let haptics: Bool
    let reduceMotion: Bool
    let allowsTouch: () -> Bool
    let onPreview: (Int) -> Void
    let onCancel: () -> Void
    let onCommit: (Int) -> Void

    func makeCoordinator() -> Controller { Controller(self) }

    func makeUIView(context: Context) -> TimelineControl {
        let control = TimelineControl()
        context.coordinator.connect(control)
        return control
    }

    func updateUIView(_ control: TimelineControl, context: Context) {
        context.coordinator.update(self)
    }

    final class Controller: NSObject, UIScrollViewDelegate {
        var input: HistoryTimeline
        private weak var control: TimelineControl?
        private var scaleDuringDrag: TimelineScale?
        private var internalChange = false
        private var lastPreview: Int?
        private var lastFeedback = 0.0
        private var committed = false
        private var interrupted = false
        private var atBoundary = false
        private var isTracking: Bool { control?.scroll.isDragging == true || control?.scroll.isDecelerating == true }
        private let spacing = 19.0

        init(_ input: HistoryTimeline) { self.input = input }

        func connect(_ control: TimelineControl) {
            self.control = control
            control.scroll.delegate = self
            control.scroll.allowsTouch = { [weak self] in self?.input.allowsTouch() ?? false }
            control.scroll.decelerationRate = .fast
            control.scroll.bounces = false
            control.ruler.drawTicks = { [weak self] context,size in self?.draw(context,size:size) }
            control.layoutAction = { [weak self] in self?.resize() }
            control.adjust = { [weak self] delta in self?.step(delta) }
            let tap = UITapGestureRecognizer(target:self,action:#selector(tap(_:)))
            tap.cancelsTouchesInView = false
            control.scroll.addGestureRecognizer(tap)
            resize()
        }

        func update(_ new: HistoryTimeline) {
            let changedScale = input.scale != new.scale
            let changedYear = input.year != new.year
            input = new
            if !isTracking && (changedScale || changedYear) { resize() }
            control?.ruler.setNeedsDisplay()
        }

        private var stride: Double { Double((scaleDuringDrag ?? input.scale).rawValue) }

        private var maximum: Double {
            Double(Chronology.index(Chronology.latest) - Chronology.index(Chronology.first)) * spacing / stride
        }

        private func offset(_ year: Int) -> Double {
            Double(Chronology.index(year)-Chronology.index(Chronology.first)) * spacing / stride
        }

        private func year(_ offset: Double) -> Int {
            let safe = offset.clamped(to:0...maximum)
            let index = Int((safe*stride/spacing).rounded()) + Chronology.index(Chronology.first)
            return Chronology.year(index)
        }

        private func resize() {
            guard let control, !isTracking else { return }
            internalChange = true
            control.scroll.contentSize = CGSize(width:maximum+control.bounds.width,height:control.bounds.height)
            control.scroll.contentOffset = CGPoint(x:offset(input.year),y:0)
            internalChange = false
            control.accessibilityValue = eraYear(input.year) + " 年"
            control.ruler.setNeedsDisplay()
        }

        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
            scaleDuringDrag = input.scale
            committed = false
            interrupted = !input.allowsTouch()
            atBoundary = false
            lastPreview = input.year
            if input.haptics { GlobeHaptics.prepareSelection() }
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            control?.ruler.setNeedsDisplay()
            guard !internalChange, scaleDuringDrag != nil else { return }
            if !input.allowsTouch() { interrupted = true }
            guard !interrupted else { return }
            let value = year(scrollView.contentOffset.x)
            guard lastPreview != value else { return }
            lastPreview = value
            control?.accessibilityValue = eraYear(value) + " 年"
            input.onPreview(value)
            let boundary = value == Chronology.first || value == Chronology.latest
            let tick = stride == 1 || value.isMultiple(of:Int(stride))
            if input.haptics && boundary && !atBoundary { GlobeHaptics.boundary() }
            else if input.haptics && tick && CACurrentMediaTime() - lastFeedback > 0.088 {
                GlobeHaptics.selection()
                lastFeedback = CACurrentMediaTime()
            }
            atBoundary = boundary
        }

        func scrollViewWillEndDragging(_ scrollView: UIScrollView,withVelocity velocity: CGPoint,
                                       targetContentOffset: UnsafeMutablePointer<CGPoint>) {
            if interrupted || !input.allowsTouch() {
                interrupted = true
                targetContentOffset.pointee.x = offset(input.year)
                return
            }
            if input.reduceMotion { targetContentOffset.pointee.x = scrollView.contentOffset.x }
            let candidate = year(targetContentOffset.pointee.x)
            targetContentOffset.pointee.x = offset(aligned(candidate))
        }

        private func aligned(_ candidate: Int) -> Int {
            let step = Int(stride)
            if step == 1 || candidate == Chronology.first || candidate == Chronology.latest { return candidate }
            let nearest = Int((Double(candidate)/stride).rounded()) * step
            let normalized = nearest == 0 ? (candidate < 0 ? -1 : 1) : nearest
            return normalized.clamped(to:Chronology.range)
        }

        func scrollViewDidEndDragging(_ scrollView: UIScrollView,willDecelerate decelerate: Bool) {
            if !decelerate { finish() }
        }

        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { finish() }

        private func finish() {
            guard let control, !committed else { return }
            committed = true
            let cancelled = interrupted || !input.allowsTouch()
            let value = cancelled ? input.year : aligned(year(control.scroll.contentOffset.x))
            internalChange = true
            control.scroll.setContentOffset(CGPoint(x:offset(value),y:0),animated:false)
            internalChange = false
            scaleDuringDrag = nil
            control.accessibilityValue = eraYear(value) + " 年"
            if cancelled { input.onCancel() }
            else { input.onCommit(value) }
        }

        @objc private func tap(_ recognizer: UITapGestureRecognizer) {
            guard let control, input.allowsTouch() else { return }
            if isTracking { finish(); return }
            let position = recognizer.location(in:control).x
            let requested = year(control.scroll.contentOffset.x + position-control.bounds.midX)
            if requested != input.year { choose(requested) }
        }

        private func step(_ direction: Int) {
            choose(Chronology.offset(input.year,direction * Int(stride)))
        }

        private func choose(_ newYear: Int) {
            guard let control else { return }
            internalChange = true
            control.scroll.setContentOffset(CGPoint(x:offset(newYear),y:0),animated:false)
            internalChange = false
            if input.haptics && newYear != input.year { GlobeHaptics.selection() }
            input.onCommit(newYear)
        }

        private func draw(_ context: CGContext,size: CGSize) {
            guard let control else { return }
            let mid = size.width/2, scroll = control.scroll.contentOffset.x
            let start = year(Double(scroll - mid - 1))
            let end = year(Double(scroll + mid + 1))
            let unit = Int(stride)
            let major = unit * 5
            guard start <= end else { return }
            for value in start...end where value != 0 {
                let isTick = value.isMultiple(of:unit)
                let event = input.hasEvent(value)
                guard isTick || event else { continue }
                let x = mid + offset(value) - scroll
                guard x >= 0 && x <= size.width else { continue }
                let opacity = min(1,min(x,size.width-x)/34)
                if isTick {
                    let large = value.isMultiple(of:major)
                    context.setStrokeColor(UIColor(white:0.82,alpha:opacity * (large ? 0.65 : 0.37)).cgColor)
                    context.setLineWidth(1)
                    context.move(to:CGPoint(x:x,y:large ? 12 : 19))
                    context.addLine(to:CGPoint(x:x,y:35))
                    context.strokePath()
                    if large {
                        let label = NSAttributedString(string:eraYear(value),attributes:[
                            .font:UIFont.monospacedDigitSystemFont(ofSize:10,weight:.regular),
                            .foregroundColor:UIColor(white:0.86,alpha:opacity)
                        ])
                        label.draw(at:CGPoint(x:x-label.size().width/2,y:40))
                    }
                }
                if event {
                    context.setFillColor(UIColor(red:0.87,green:0.73,blue:0.47,alpha:opacity).cgColor)
                    context.fillEllipse(in:CGRect(x:x-2,y:4,width:4,height:4))
                }
            }
            context.setStrokeColor(UIColor(red:0.79,green:0.32,blue:0.24,alpha:1).cgColor)
            context.setLineWidth(2)
            context.move(to:CGPoint(x:mid,y:8))
            context.addLine(to:CGPoint(x:mid,y:38))
            context.strokePath()
        }
    }
}

final class TimelineControl: UIView {
    let scroll = Scroller()
    let ruler = Ruler()
    var layoutAction: (() -> Void)?
    var adjust: ((Int) -> Void)?
    private var lastSize = CGSize.zero

    override init(frame: CGRect) {
        super.init(frame:frame)
        scroll.showsHorizontalScrollIndicator = false
        scroll.showsVerticalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.isAccessibilityElement = false
        ruler.isOpaque = false
        ruler.isUserInteractionEnabled = false
        addSubview(scroll)
        addSubview(ruler)
        isAccessibilityElement = true
        accessibilityTraits = .adjustable
        accessibilityLabel = "历史时间轴"
        accessibilityIdentifier = "timeline-ruler"
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        scroll.frame = bounds
        ruler.frame = bounds
        if lastSize != bounds.size {
            lastSize = bounds.size
            layoutAction?()
        }
    }
    override func accessibilityIncrement() { adjust?(1) }
    override func accessibilityDecrement() { adjust?(-1) }

    final class Scroller: UIScrollView {
        var allowsTouch: () -> Bool = { true }

        override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            allowsTouch() && super.gestureRecognizerShouldBegin(gestureRecognizer)
        }
    }

    final class Ruler: UIView {
        var drawTicks: ((CGContext,CGSize) -> Void)?
        override func draw(_ rect: CGRect) {
            if let context = UIGraphicsGetCurrentContext() { drawTicks?(context,bounds.size) }
        }
    }
}
