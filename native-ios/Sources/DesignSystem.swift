import SwiftUI
import UIKit

enum Design {
    static let space = Color(red:10/255,green:16/255,blue:22/255)
    static let paper = Color(red:246/255,green:242/255,blue:233/255)
    static let gold = Color(red:222/255,green:188/255,blue:120/255)
    static let vermilion = Color(red:154/255,green:49/255,blue:33/255)
    static let indigo = Color(red:55/255,green:68/255,blue:113/255)
    static let ink = Color(red:35/255,green:31/255,blue:27/255)
    static let quiet = Color(red:112/255,green:101/255,blue:86/255)
    static let rule = Color(red:146/255,green:124/255,blue:90/255).opacity(0.28)

    static let inset: CGFloat = 24
    static let minimumTap: CGFloat = 44

    static func motion(_ reduceMotion: Bool = UIAccessibility.isReduceMotionEnabled) -> Animation? {
        reduceMotion ? nil : .spring(response:0.32,dampingFraction:0.88,blendDuration:0.08)
    }

    static func font(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        if UIFont(name:"SongtiSC-Regular",size:size) != nil { return .custom("SongtiSC-Regular",size:size,relativeTo:style) }
        if UIFont(name:"STSongti-SC-Regular",size:size) != nil { return .custom("STSongti-SC-Regular",size:size,relativeTo:style) }
        return .system(size:size,design:.serif)
    }
}

extension ReaderPaper {
    var background: Color {
        switch self {
        case .paper: return Design.paper
        case .bright: return Color(white:0.99)
        case .night: return Color(red:0.075,green:0.089,blue:0.11)
        }
    }
    var text: Color { self == .night ? Color(white:0.89) : Design.ink }
    var quiet: Color { self == .night ? Color(white:0.64) : Design.quiet }
    var link: Color { self == .night ? Color(red:0.65,green:0.72,blue:0.99) : Design.indigo }
    var accent: Color { self == .night ? Color(red:0.99,green:0.62,blue:0.54) : Design.vermilion }
}

struct IconAction: View {
    let icon: String
    let label: String
    var tint: Color = .primary
    let action: () -> Void

    var body: some View {
        Button(action:action) {
            Image(systemName:icon).font(.system(size:17,weight:.medium))
                .frame(width:Design.minimumTap,height:Design.minimumTap)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(tint)
        .accessibilityLabel(label)
    }
}

struct PaperAction: View {
    let title: String
    var symbol: String? = nil
    var prominent = false
    var paper = ReaderPaper.paper
    let action: () -> Void

    var body: some View {
        Button(action:action) {
            HStack(spacing:10) {
                if let symbol { Image(systemName:symbol) }
                Text(title).font(.subheadline.weight(.semibold)).multilineTextAlignment(.leading)
                Spacer(minLength:0)
                Image(systemName:"chevron.forward").font(.caption.weight(.semibold))
                    .accessibilityHidden(true)
            }
            .padding(.horizontal,prominent ? 14 : 0)
            .frame(minHeight:Design.minimumTap)
            .contentShape(Rectangle())
            .background(prominent ? paper.accent.opacity(0.11) : Color.clear,in:RoundedRectangle(cornerRadius:9))
        }
        .buttonStyle(.plain)
        .foregroundStyle(prominent ? paper.accent : paper.link)
    }
}

struct PaperHeader: View {
    let title: String
    var subtitle: String?
    var paper = ReaderPaper.paper

    var body: some View {
        VStack(alignment:.leading,spacing:8) {
            if let subtitle {
                Text(subtitle).font(.footnote).foregroundStyle(paper.quiet)
            }
            Text(title)
                .font(.system(.largeTitle,design:.serif,weight:.semibold))
                .foregroundStyle(paper.text).accessibilityAddTraits(.isHeader)
        }
        .frame(maxWidth:.infinity,alignment:.leading)
    }
}

struct SourceLine: View {
    let source: HistorySource
    var paper = ReaderPaper.paper
    var body: some View {
        VStack(alignment:.leading,spacing:5) {
            if let url = source.link {
                Link(source.title,destination:url).foregroundStyle(paper.link)
            } else { Text(source.title).foregroundStyle(paper.text) }
            if let note = source.note { Text(note).foregroundStyle(paper.quiet) }
            if let audit = source.audit {
                Text(audit.label).foregroundStyle(paper.quiet)
                if let scope = audit.scope { Text(scope).foregroundStyle(paper.quiet) }
                if let note = audit.note { Text(note).foregroundStyle(paper.quiet) }
            }
        }
        .font(.footnote)
        .padding(.vertical,4)
        .textSelection(.enabled)
    }
}

struct EvidenceDetails: View {
    let evidence: [Evidence]
    let sources: [HistorySource]
    var paper = ReaderPaper.paper

    var body: some View {
        ForEach(Array(evidence.enumerated()),id:\.offset) { _,ref in
            VStack(alignment:.leading,spacing:6) {
                if let source = sources.first(where:{ $0.id == ref.sourceId }) { SourceLine(source:source,paper:paper) }
                else { Text(ref.sourceId).font(.footnote) }
                if let locator = ref.locator { Text(locator).font(.subheadline) }
                if let note = ref.note { Text(note).font(.footnote).foregroundStyle(paper.quiet) }
                Divider()
            }
            .textSelection(.enabled)
        }
    }
}

struct MapDrawer<Trailing: View, Body: View>: View {
    @Binding var position: DrawerPosition
    let available: CGFloat
    let title: String
    let subtitle: String?
    @ViewBuilder let trailing: Trailing
    @ViewBuilder let details: Body
    @GestureState private var drag: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing:0) {
            VStack(alignment:.leading,spacing:0) {
                Capsule().fill(Design.quiet.opacity(0.4)).frame(width:32,height:4)
                    .frame(maxWidth:.infinity).padding(.top,9).padding(.bottom,8)
                HStack(alignment:.center,spacing:8) {
                    VStack(alignment:.leading,spacing:3) {
                        Text(title).font(.system(.title3,design:.serif,weight:.semibold)).lineLimit(position == .expanded ? 3 : 1)
                            .accessibilityAddTraits(.isHeader)
                        if let subtitle {
                            Text(subtitle).font(.caption).foregroundStyle(Design.quiet).lineLimit(2)
                        }
                    }
                    Spacer(minLength:2)
                    trailing
                }
                .padding(.horizontal,Design.inset)
                .padding(.bottom,8)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance:12).updating($drag) { value,state,_ in
                state = -value.translation.height
            }.onEnded { value in
                let target = height(position) - value.predictedEndTranslation.height * 0.68 - value.translation.height * 0.32
                let best = DrawerPosition.allCases.min { abs(height($0)-target) < abs(height($1)-target) } ?? position
                withAnimation(Design.motion(reduceMotion)) { position = best }
            })
            .accessibilityAdjustableAction { direction in
                if direction == .increment { move(1) }
                if direction == .decrement { move(-1) }
            }
            if position != .collapsed || drag > 25 {
                Rectangle().fill(Design.rule).frame(height:1)
                ScrollView {
                    VStack(alignment:.leading,spacing:13) { details }
                        .frame(maxWidth:.infinity,alignment:.leading)
                        .padding(.horizontal,Design.inset).padding(.vertical,14)
                }
                .scrollIndicators(.hidden)
            }
            Spacer(minLength:0)
        }
        .frame(maxWidth:.infinity)
        .frame(height:(height(position)+drag).clamped(to:height(.collapsed)...height(.expanded)),alignment:.top)
        .foregroundStyle(Design.ink)
        .background(Design.paper, in:UnevenTop())
        .background(alignment:.bottom) { Design.paper.frame(height:12).ignoresSafeArea(edges:.bottom) }
        .environment(\.colorScheme,.light)
    }

    func height(_ detent: DrawerPosition) -> CGFloat {
        switch detent {
        case .collapsed: return 80
        case .summary: return max(112,min(232,available * 0.31))
        case .expanded: return max(112,min(available - 112,available * 0.62))
        }
    }

    private func move(_ delta: Int) {
        let index = (position.rawValue + delta).clamped(to:0...2)
        if let next = DrawerPosition(rawValue:index) { withAnimation(Design.motion(reduceMotion)) { position = next } }
    }
}

private struct UnevenTop: Shape {
    func path(in rect: CGRect) -> Path {
        Path(UIBezierPath(roundedRect:rect,byRoundingCorners:[.topLeft,.topRight],cornerRadii:CGSize(width:21,height:21)).cgPath)
    }
}

struct EdgeReturn: UIViewRepresentable {
    var action: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(action) }
    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        let gesture = UIScreenEdgePanGestureRecognizer(target:context.coordinator,action:#selector(Coordinator.go(_:)))
        gesture.edges = .left
        view.addGestureRecognizer(gesture)
        view.accessibilityElementsHidden = true
        return view
    }
    func updateUIView(_ view: UIView,context: Context) { context.coordinator.action = action }

    final class Coordinator: NSObject {
        var action: () -> Void
        init(_ action: @escaping () -> Void) { self.action = action }
        @objc func go(_ gesture: UIScreenEdgePanGestureRecognizer) {
            guard gesture.state == .ended, gesture.translation(in:gesture.view).x > 45 else { return }
            action()
        }
    }
}
