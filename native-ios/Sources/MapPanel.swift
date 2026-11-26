import SwiftUI
import UIKit

/// Lives over the full window. Only the visible paper intercepts touches.
struct MapPanel<Compact: View, Full: View>: UIViewControllerRepresentable {
    let position: DrawerPosition
    let viewport: GlobeViewport
    var canDismiss = false
    var dismissal = 0
    var onPosition: (DrawerPosition) -> Void
    var onDismiss: () -> Void = {}
    @ViewBuilder var compact: () -> Compact
    @ViewBuilder var full: () -> Full

    @Environment(\.accessibilityReduceMotion) private var reduced
    @Environment(\.mapStatusBar) private var statusBar

    func makeUIViewController(context: Context) -> PaperPanelController {
        PaperPanelController()
    }

    func updateUIViewController(_ controller: PaperPanelController, context: Context) {
        controller.update(position:position, canDismiss:canDismiss, dismissal:dismissal, reduced:reduced,
                          compact:AnyView(compact().environment(\.colorScheme,.light)),
                          full:AnyView(full().environment(\.colorScheme,.light)),
                          onHeight:{ viewport.protect(bottom:$0) },
                          onPosition:onPosition,onDismiss:onDismiss,onStatus:statusBar)
    }

    static func dismantleUIViewController(_ controller: PaperPanelController, coordinator: ()) {
        controller.stop()
    }
}

@MainActor
final class PaperPanelController: UIViewController, UIScrollViewDelegate, UIGestureRecognizerDelegate {
    private final class PassThroughView: UIView {
        weak var card: UIView?
        override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
            guard card?.frame.contains(point) == true else { return nil }
            return super.hitTest(point,with:event)
        }
    }

    private enum Edge { case compact, full, closed }
    private let card = UIView()
    private let compactHost = UIHostingController(rootView:AnyView(EmptyView()))
    private let fullHost = UIHostingController(rootView:AnyView(EmptyView()))
    private let scroll = UIScrollView()
    private var fullTop: NSLayoutConstraint?
    private var fullBottom: NSLayoutConstraint?
    private var current: CGFloat = 0
    private var compactHeight: CGFloat = 0
    private var target: Edge = .compact
    private var state: DrawerPosition?
    private var dragging = false
    private var dragOrigin: CGFloat = 0
    private var dragState: DrawerPosition = .compact
    private var scrollStart: CGFloat = 0
    private var lastScrollTranslation: CGFloat = 0
    private var scrollHasReturnedToTop = false
    private var fingerDownOnScroll = false
    private var panStart: CGFloat?
    private var animation: (from:CGFloat, began:Double, duration:Double)?
    private var link: CADisplayLink?
    private var allowDismiss = false
    private var lastDismissal: Int?
    private var reduced = false
    private var onHeight: (CGFloat) -> Void = { _ in }
    private var onPosition: (DrawerPosition) -> Void = { _ in }
    private var onDismiss: () -> Void = {}
    private var onStatus: (Bool) -> Void = { _ in }
    private var statusIsPaper = false

    override func loadView() {
        let passThrough = PassThroughView()
        passThrough.card = card
        passThrough.backgroundColor = .clear
        view = passThrough
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        card.backgroundColor = UIColor(Design.paper)
        card.clipsToBounds = true
        card.layer.cornerCurve = .continuous
        card.layer.maskedCorners = [.layerMinXMinYCorner,.layerMaxXMinYCorner]
        view.addSubview(card)
        card.addSubview(scroll)
        scroll.delegate = self
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.alwaysBounceVertical = true
        scroll.isDirectionalLockEnabled = true
        scroll.delaysContentTouches = false
        scroll.showsHorizontalScrollIndicator = false
        attach(compactHost,to:card)
        attach(fullHost,to:scroll)
        fullHost.sizingOptions = .intrinsicContentSize
        let fullView = fullHost.view!
        fullView.translatesAutoresizingMaskIntoConstraints = false
        let top = fullView.topAnchor.constraint(equalTo:scroll.contentLayoutGuide.topAnchor)
        let bottom = scroll.contentLayoutGuide.bottomAnchor.constraint(equalTo:fullView.bottomAnchor)
        fullTop = top
        fullBottom = bottom
        NSLayoutConstraint.activate([
            top,bottom,
            fullView.leadingAnchor.constraint(equalTo:scroll.contentLayoutGuide.leadingAnchor),
            scroll.contentLayoutGuide.trailingAnchor.constraint(equalTo:fullView.trailingAnchor),
            fullView.widthAnchor.constraint(equalTo:scroll.frameLayoutGuide.widthAnchor)
        ])
        // Horizontal insets live inside the SwiftUI content. Keep the scroll layout one viewport wide.
        let pan = UIPanGestureRecognizer(target:self,action:#selector(dragPaper(_:)))
        pan.delegate = self
        card.addGestureRecognizer(pan)
        scroll.panGestureRecognizer.addTarget(self,action:#selector(dragScroll(_:)))
    }

    private func attach(_ child: UIHostingController<AnyView>, to parent: UIView) {
        addChild(child)
        child.view.backgroundColor = .clear
        parent.addSubview(child.view)
        child.didMove(toParent:self)
    }

    func update(position: DrawerPosition, canDismiss: Bool, dismissal: Int, reduced: Bool, compact: AnyView, full: AnyView,
                onHeight: @escaping (CGFloat) -> Void, onPosition: @escaping (DrawerPosition) -> Void,
                onDismiss: @escaping () -> Void, onStatus: @escaping (Bool) -> Void) {
        loadViewIfNeeded()
        self.allowDismiss = canDismiss
        self.reduced = reduced
        self.onHeight = onHeight
        self.onPosition = onPosition
        self.onDismiss = onDismiss
        self.onStatus = onStatus
        compactHost.rootView = compact
        fullHost.rootView = full
        if state != position {
            state = position
            if !dragging { settle(position == .full ? .full : .compact, animated:current > 0 || position == .compact) }
        }
        if let previous = lastDismissal, previous != dismissal { settle(.closed,animated:true) }
        lastDismissal = dismissal
        view.setNeedsLayout()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard view.bounds.width > 0, view.bounds.height > 0 else { return }
        let previous = compactHeight
        let safe = safeInsets
        let measure = compactHost.sizeThatFits(in:CGSize(width:view.bounds.width,height:.greatestFiniteMagnitude))
        compactHeight = min(ceil(measure.height) + safe.bottom, max(1,view.bounds.height-safe.top))
        fullTop?.constant = safe.top
        fullBottom?.constant = safe.bottom
        if !dragging, animation == nil {
            if current == 0 && previous == 0 && target == .compact && !reduced {
                settle(.compact,animated:true)
            } else { current = height(target) }
        }
        layoutPaper()
    }

    private var safeInsets: UIEdgeInsets { view.window?.safeAreaInsets ?? view.safeAreaInsets }

    private func height(_ edge: Edge) -> CGFloat {
        switch edge {
        case .compact: return compactHeight
        case .full: return view.bounds.height
        case .closed: return 0
        }
    }

    private func layoutPaper() {
        let viewHeight = view.bounds.height
        let width = view.bounds.width
        let h = min(viewHeight,max(0,current))
        guard width > 0, viewHeight > 0 else { return }
        let share = ((h-compactHeight)/max(1,viewHeight-compactHeight)).clamped(to:0...1)
        card.frame = CGRect(x:0,y:viewHeight-h,width:width,height:h)
        card.layer.cornerRadius = 23 * (1-share)
        // The background clips both hosts and extends through the Home Indicator.
        compactHost.view.frame = CGRect(x:0,y:0,width:width,height:max(0,compactHeight-safeInsets.bottom))
        scroll.frame = CGRect(x:0,y:0,width:width,height:h)
        scroll.alpha = ((share-0.10)/0.55).clamped(to:0...1)
        compactHost.view.alpha = (1-share/0.55).clamped(to:0...1)
        let fullDominates = share > 0.47
        if !fingerDownOnScroll {
            scroll.isUserInteractionEnabled = fullDominates
            compactHost.view.isUserInteractionEnabled = !fullDominates
        }
        compactHost.view.accessibilityElementsHidden = fullDominates
        scroll.accessibilityElementsHidden = !fullDominates
        card.accessibilityViewIsModal = h >= viewHeight-1
        let underStatus = viewHeight-h < max(1,safeInsets.top*0.22)
        if statusIsPaper != underStatus {
            statusIsPaper = underStatus
            DispatchQueue.main.async { [weak self] in
                guard let self, self.statusIsPaper == underStatus else { return }
                self.onStatus(underStatus)
            }
        }
        onHeight(h)
    }

    private func settle(_ edge: Edge, animated: Bool) {
        target = edge
        if !animated || reduced || (view.bounds.height > 0 && abs(current-height(edge)) < 0.5) {
            animation = nil
            link?.isPaused = true
            current = height(edge)
            layoutPaper()
            if edge == .closed { onDismiss() }
            return
        }
        animation = (current,CACurrentMediaTime(),0.34)
        if link == nil {
            let display = CADisplayLink(target:self,selector:#selector(step(_:)))
            let maximum = Float(view.window?.screen.maximumFramesPerSecond ?? 60)
            display.preferredFrameRateRange = CAFrameRateRange(minimum:min(60,maximum),maximum:maximum,preferred:maximum)
            display.add(to:.main,forMode:.common)
            link = display
        }
        link?.isPaused = false
    }

    @objc private func step(_ display: CADisplayLink) {
        guard let animation else { display.isPaused = true; return }
        let fraction = ((display.targetTimestamp-animation.began)/animation.duration).clamped(to:0...1)
        let ease = CGFloat(1-pow(1-fraction,3))
        current = animation.from+(height(target)-animation.from)*ease
        layoutPaper()
        if fraction >= 1 {
            self.animation = nil
            display.isPaused = true
            if target == .closed { onDismiss() }
        }
    }

    func stop() {
        link?.invalidate()
        link = nil
        animation = nil
        onHeight(0)
        if statusIsPaper {
            statusIsPaper = false
            let clear = onStatus
            DispatchQueue.main.async { clear(false) }
        }
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
        let location = pan.location(in:card)
        let v = pan.velocity(in:card)
        guard abs(v.y) > abs(v.x) else { return false }
        if scroll.isUserInteractionEnabled && scroll.frame.contains(location) { return false }
        return true
    }

    private func beginDrag(from reference: CGFloat) {
        animation = nil
        link?.isPaused = true
        dragging = true
        dragOrigin = current
        dragState = current > compactHeight + (view.bounds.height-compactHeight)*0.52 ? .full : .compact
        panStart = reference
    }

    private func moveDrag(by translation: CGFloat) {
        guard let panStart else { return }
        let minimum = allowDismiss && dragState == .compact ? 0 : compactHeight
        current = (dragOrigin-(translation-panStart)).clamped(to:minimum...max(minimum,view.bounds.height))
        layoutPaper()
    }

    private func endDrag(velocity: CGFloat, cancelled: Bool) {
        guard dragging else { return }
        dragging = false
        panStart = nil
        let span = max(1,view.bounds.height-compactHeight)
        let projected = current-velocity*0.18
        let direction: Edge
        if cancelled {
            direction = state == .full ? .full : .compact
        } else if dragState == .full {
            direction = projected < view.bounds.height-min(135,span*0.29) ? .compact : .full
        } else if projected > compactHeight+min(115,span*0.25) {
            direction = .full
        } else if allowDismiss && projected < compactHeight-min(66,compactHeight*0.38) {
            direction = .closed
        } else {
            direction = .compact
        }
        if direction != .closed {
            let position: DrawerPosition = direction == .full ? .full : .compact
            state = position
            onPosition(position)
        }
        settle(direction,animated:true)
    }

    @objc private func dragPaper(_ pan: UIPanGestureRecognizer) {
        let y = pan.translation(in:view).y
        switch pan.state {
        case .began: beginDrag(from:0); moveDrag(by:y)
        case .changed: moveDrag(by:y)
        case .ended, .cancelled, .failed: endDrag(velocity:pan.velocity(in:view).y,cancelled:pan.state != .ended)
        default: break
        }
    }

    @objc private func dragScroll(_ pan: UIPanGestureRecognizer) {
        let y = pan.translation(in:view).y
        switch pan.state {
        case .began:
            fingerDownOnScroll = true
            scrollStart = max(0,scroll.contentOffset.y)
            lastScrollTranslation = 0
            scrollHasReturnedToTop = scrollStart <= 0.5
            if animation != nil && pan.velocity(in:view).y > 0 {
                beginDrag(from:0)
                moveDrag(by:y)
            }
        case .changed:
            if !dragging, y > lastScrollTranslation, scroll.contentOffset.y <= 0.5 {
                let translationAtTop = scrollHasReturnedToTop ? min(y,max(0,lastScrollTranslation)) :
                    (lastScrollTranslation >= 0 ? min(y,max(scrollStart,lastScrollTranslation)) : y)
                beginDrag(from:translationAtTop)
            }
            if dragging {
                if scroll.contentOffset.y != 0 { scroll.contentOffset.y = 0 }
                moveDrag(by:y)
            }
            if scroll.contentOffset.y <= 0.5 { scrollHasReturnedToTop = true }
            lastScrollTranslation = y
        case .ended, .cancelled, .failed:
            fingerDownOnScroll = false
            endDrag(velocity:pan.velocity(in:view).y,cancelled:pan.state != .ended)
        default: break
        }
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if dragging && fingerDownOnScroll && scrollView.contentOffset.y != 0 {
            scrollView.contentOffset.y = 0
        }
    }

    func scrollViewWillEndDragging(_ scrollView: UIScrollView, withVelocity velocity: CGPoint,
                                   targetContentOffset: UnsafeMutablePointer<CGPoint>) {
        if dragging { targetContentOffset.pointee.y = 0 }
    }
}

private struct ChromeEdge: ViewModifier {
    let top: Bool
    let viewport: GlobeViewport

    func body(content: Content) -> some View {
        content.background {
            GeometryReader { proxy in
                let frame = proxy.frame(in:.global)
                let safeInset = top ? max(0,frame.minY) : proxy.safeAreaInsets.bottom
                let height = proxy.size.height + safeInset
                Color.clear
                    .onAppear { update(height) }
                    .onChange(of:height) { update($0) }
            }
        }
        .background(alignment:top ? .bottom : .top) {
            LinearGradient(stops:top ? [
                .init(color:Design.space.opacity(0.97),location:0),
                .init(color:Design.space.opacity(0.93),location:0.47),
                .init(color:Design.space.opacity(0.68),location:0.78),
                .init(color:Design.space.opacity(0),location:1)
            ] : [
                .init(color:Design.space.opacity(0),location:0),
                .init(color:Design.space.opacity(0.72),location:0.31),
                .init(color:Design.space.opacity(0.95),location:0.65),
                .init(color:Design.space,location:1)
            ],startPoint:.top,endPoint:.bottom)
            .padding(top ? .bottom : .top,-24)
            .ignoresSafeArea(edges:top ? .top : .bottom)
            .allowsHitTesting(false)
        }
    }

    private func update(_ height: CGFloat) {
        if top { viewport.protect(top:height) }
        else { viewport.protect(chromeBottom:height) }
    }
}

extension View {
    func mapChrome(top: Bool, viewport: GlobeViewport) -> some View {
        modifier(ChromeEdge(top:top,viewport:viewport))
    }
}

struct SheetHandle: View {
    var body: some View {
        Capsule().fill(Design.quiet.opacity(0.43))
            .frame(width:36,height:4).padding(.top,8)
            .frame(maxWidth:.infinity)
            .accessibilityHidden(true)
    }
}
