import SwiftUI
import UIKit

struct ChapterPage: View {
    let content: AppContent
    @ObservedObject var session: SessionStore
    let node: ReadingNode
    let volume: Volume
    let chapter: Chapter
    let openContents: () -> Void
    @State private var page: ChapterBody?
    @State private var failed = false
    @State private var retry = 0
    @State private var citations: CitationContext?
    @State private var metrics: [String: CGRect] = [:]
    @State private var readingPosition: ReadingPosition?
    @State private var restoreGeneration = 0
    @State private var restored = false
    @StateObject private var scrollView = ReaderScrollLink()
    @Environment(\.dynamicTypeSize) private var dynamicType

    private var paper: ReaderPaper { session.preferences.paper }
    private var styleSize: CGFloat { CGFloat(session.preferences.textSize.rawValue) }

    private struct CitationContext: Identifiable {
        let id = UUID()
        let evidence: [Evidence]
        let sources: [HistorySource]
    }

    var body: some View {
        Group {
            if let page {
                passage(page)
            } else if failed {
                VStack(spacing:14) {
                    Text("这一章暂时无法读取")
                    Button("重试") { retry += 1 }
                }
                .frame(maxWidth:.infinity,maxHeight:.infinity)
            } else {
                ProgressView("正在读取正文").frame(maxWidth:.infinity,maxHeight:.infinity)
            }
        }
        .task(id:retry) {
            failed = false
            do {
                let body = try await content.history.chapters.load(chapter)
                try Task.checkCancellation()
                readingPosition = node.focusBlock == "__start__" ? nil : session.position(volume:volume,chapter:chapter)
                page = body
            } catch is CancellationError {
                return
            } catch {
                failed = true
            }
        }
        .sheet(item:$citations) { data in
            PaperSheet(title:"史料注释",subtitle:chapter.title,paper:paper) {
                EvidenceDetails(evidence:data.evidence,sources:data.sources,paper:paper)
            }
            .presentationDetents([.medium,.large])
        }
    }

    private func passage(_ page: ChapterBody) -> some View {
        let sources = page.sources ?? volume.sources ?? []
        let ids = Dictionary(sources.enumerated().map { ($0.element.id,$0.offset + 1) },uniquingKeysWith:{ first,_ in first })
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment:.leading,spacing:22) {
                    heading(page)
                        .background(ReadingMeasure(id:"__start__"))
                        .id("__start__")
                        .background(ScrollDiscovery(link:scrollView).frame(width:0,height:0))
                    ForEach(page.blocks) { block in
                        let references = page.scenes.filter { $0.afterBlockId == block.id }
                        passageBlock(block,identifiers:ids,sources:sources,sceneRefs:page.scenes)
                            .background(ReadingMeasure(id:block.id))
                            .id(block.id)
                        ForEach(Array(references.enumerated()),id:\.offset) { _,reference in
                            observationPlate(reference)
                        }
                    }
                    ForEach(Array(page.scenes.filter { $0.afterBlockId == nil }.enumerated()),id:\.offset) { _,reference in
                        observationPlate(reference)
                    }
                    relations(page.links + volume.links,sources:sources)
                    if !sources.isEmpty {
                        DisclosureGroup("本章来源") {
                            VStack(alignment:.leading,spacing:8) {
                                ForEach(sources) { SourceLine(source:$0,paper:paper) }
                            }
                            .padding(.vertical,8)
                        }
                        .tint(paper.link)
                    }
                    ending
                }
                .padding(.horizontal,Design.inset).padding(.vertical,24)
                .frame(maxWidth:620,alignment:.leading).frame(maxWidth:.infinity)
            }
            .coordinateSpace(name:"chapter-passage")
            .accessibilityIdentifier("chapter-scroll")
            .onPreferenceChange(BlockFrames.self) { values in
                metrics = values
                guard restored else { return }
                capture(values,blocks:page.blocks)
            }
            .onChange(of:session.preferences.textSize) { _ in preservePosition() }
            .onChange(of:dynamicType) { _ in preservePosition() }
            .task(id:restoreGeneration) {
                restored = false
                let anchor = readingPosition?.anchor(in:page.blocks)
                let explicit = node.focusBlock.flatMap { id in page.blocks.contains { $0.id == id } ? id : nil }
                let target = (restoreGeneration == 0 ? explicit : nil) ?? anchor?.0 ?? "__start__"
                let fraction = explicit == target || target == "__start__" ? 0 : (anchor?.1 ?? 0)
                await Task.yield()
                guard !Task.isCancelled else { return }
                proxy.scrollTo(target,anchor:.top)
                if fraction > 0 {
                    for _ in 0..<4 {
                        try? await Task.sleep(nanoseconds:45_000_000)
                        guard !Task.isCancelled else { return }
                        if let frame = metrics[target], scrollView.adjust(by:frame.minY + fraction*frame.height) { break }
                    }
                }
                try? await Task.sleep(nanoseconds:60_000_000)
                guard !Task.isCancelled else { return }
                restored = true
                if readingPosition?.chapter != chapter.id {
                    session.record(ReadingPosition(volume:volume.id,chapter:chapter.id,block:explicit))
                } else if let position = readingPosition {
                    session.record(ReadingPosition(volume:volume.id,chapter:chapter.id,block:position.block,
                                                   fraction:position.fraction,fallback:position.fallback))
                }
            }
        }
    }

    private func heading(_ page: ChapterBody) -> some View {
        VStack(alignment:.leading,spacing:12) {
            PaperHeader(title:chapter.title,subtitle:chapter.dateText,paper:paper).accessibilityIdentifier("chapter-title")
            if let summary = chapter.summary { Text(summary).font(.headline).lineSpacing(4) }
            if let scope = page.scope { Text(scope).font(.footnote).foregroundStyle(paper.quiet) }
            if let thesis = page.thesis {
                HStack(alignment:.top,spacing:11) {
                    Rectangle().fill(paper.accent.opacity(0.7)).frame(width:2)
                    Text(thesis).font(Design.font(17)).lineSpacing(5).foregroundStyle(paper.quiet)
                        .fixedSize(horizontal:false,vertical:true)
                }
                .fixedSize(horizontal:false,vertical:true)
            }
        }
    }

    private func passageBlock(_ block: TextBlock,identifiers: [String:Int],sources: [HistorySource],sceneRefs: [SceneRef]) -> some View {
        VStack(alignment:.leading,spacing:9) {
            if let heading = block.heading {
                Text(heading).font(.system(.title2,design:.serif,weight:.semibold))
                    .accessibilityAddTraits(.isHeader)
            }
            Text(attributed(block,scenes:sceneRefs))
                .font(Design.font(styleSize)).lineSpacing(8).tracking(0.24)
                .textSelection(.enabled)
                .environment(\.openURL,OpenURLAction { url in
                    if url.scheme == "spacetime-scene", let scene = url.host,
                       let list = URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems,
                       content.archive.scene(scene) != nil {
                        session.startObservation(.scene(scene),stage:list.first { $0.name == "stage" }?.value,
                                                 place:list.first { $0.name == "place" }?.value)
                        return .handled
                    }
                    return .systemAction
                })
            if !block.refs.isEmpty { referenceButton(block.refs,indices:identifiers,sources:sources) }
            if let callout = block.callout {
                VStack(alignment:.leading,spacing:7) {
                    if let title = callout.title ?? callout.label { Text(title).font(.subheadline.weight(.semibold)) }
                    Text(callout.text).font(Design.font(max(15,styleSize-2))).lineSpacing(5).textSelection(.enabled)
                    if !callout.refs.isEmpty { referenceButton(callout.refs,indices:identifiers,sources:sources) }
                }
                .padding(14).frame(maxWidth:.infinity,alignment:.leading)
                .background(paper.quiet.opacity(0.08),in:RoundedRectangle(cornerRadius:8))
            }
        }
    }

    private func referenceButton(_ refs: [Evidence],indices: [String:Int],sources: [HistorySource]) -> some View {
        let numbers = Array(Set(refs.compactMap { indices[$0.sourceId] })).sorted()
        let title = numbers.isEmpty ? "注" : numbers.map { "[\($0)]" }.joined(separator:" ")
        return Button { citations = CitationContext(evidence:refs,sources:sources) } label: {
            Text(title).font(.footnote.weight(.semibold)).foregroundStyle(paper.link)
                .padding(.horizontal,5).frame(minHeight:44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("查看本段史料注释")
    }

    @ViewBuilder private func observationPlate(_ reference: SceneRef) -> some View {
        if let scene = content.archive.scene(reference.id) {
            VStack(alignment:.leading,spacing:6) {
                Rectangle().fill(paper.quiet.opacity(0.24)).frame(height:1)
                PaperAction(title:scene.title,symbol:"map",paper:paper) {
                    session.startObservation(.scene(scene.id),stage:reference.stageId)
                }
                .accessibilityIdentifier("open-observation")
                if let question = scene.question { Text(question).font(.footnote).foregroundStyle(paper.quiet) }
            }
        }
    }

    @ViewBuilder private func relations(_ links: [ReadingLink],sources: [HistorySource]) -> some View {
        ForEach(RelationKind.allCases,id:\.rawValue) { kind in
            let group = links.filter { $0.kind == kind && content.archive.volume($0.volume) != nil }
            if !group.isEmpty {
                VStack(alignment:.leading,spacing:6) {
                    Divider()
                    Text(kind.title).font(.headline).foregroundStyle(paper.text)
                    ForEach(Array(group.enumerated()),id:\.offset) { _,link in
                        if let related = content.archive.volume(link.volume) {
                            PaperAction(title:link.label ?? related.title,paper:paper) {
                                session.open(ReadingNode(volume:related.id,chapter:link.chapter,entryYear:node.entryYear))
                            }
                            if let dimension = link.dimension { Text(dimension).font(.footnote).foregroundStyle(paper.quiet) }
                            if let note = link.note { Text(note).font(.footnote).foregroundStyle(paper.quiet) }
                            if !link.refs.isEmpty {
                                let ids = Dictionary(sources.enumerated().map { ($0.element.id,$0.offset+1) },
                                                     uniquingKeysWith:{ first,_ in first })
                                referenceButton(link.refs,indices:ids,sources:sources)
                            }
                        }
                    }
                }
            }
        }
    }

    private var ending: some View {
        VStack(spacing:6) {
            Divider()
            if let current = volume.chapters.firstIndex(where:{ $0.id == chapter.id }) {
                if current > 0 {
                    PaperAction(title:"上一章 · " + volume.chapters[current-1].title,paper:paper) { turn(current-1) }
                }
                if current + 1 < volume.chapters.count {
                    PaperAction(title:"下一章 · " + volume.chapters[current+1].title,prominent:true,paper:paper) { turn(current+1) }
                }
            }
            PaperAction(title:"返回目录",symbol:"list.bullet",paper:paper,action:openContents)
        }
    }

    private func turn(_ index: Int) {
        session.switchChapter(ReadingNode(volume:volume.id,chapter:volume.chapters[index].id,entryYear:node.entryYear))
    }

    private func attributed(_ block: TextBlock,scenes: [SceneRef]) -> AttributedString {
        var value = AttributedString(block.text)
        for scene in scenes where content.archive.scene(scene.id) != nil {
            for link in scene.placeLinks ?? [] where link.blockId == block.id {
                guard let range = value.range(of:link.text) else { continue }
                var url = URLComponents()
                url.scheme = "spacetime-scene"
                url.host = scene.id
                url.queryItems = [URLQueryItem(name:"place",value:link.placeId),URLQueryItem(name:"stage",value:link.stageId ?? scene.stageId)]
                value[range].link = url.url
            }
        }
        return value
    }

    private func capture(_ frames: [String:CGRect],blocks: [TextBlock]) {
        let atTop = frames.filter { $0.value.minY <= 14 }
            .max { $0.value.minY < $1.value.minY }
        guard let atTop else { return }
        let block = atTop.key == "__start__" ? nil : atTop.key
        let fraction = block != nil ? (-atTop.value.minY / max(atTop.value.height,1)).clamped(to:0...1) : 0
        let quantized = (Double(fraction)*100).rounded()/100
        let index = block.flatMap { target in blocks.firstIndex { $0.id == target } }
        let nearby = index.map { i in
            [i+1,i-1,i+2,i-2].filter { blocks.indices.contains($0) }.map { blocks[$0].id }
        } ?? []
        let position = ReadingPosition(volume:volume.id,chapter:chapter.id,block:block,fraction:quantized,fallback:nearby)
        if position != readingPosition {
            readingPosition = position
            session.record(position)
        }
    }

    private func preservePosition() {
        restored = false
        restoreGeneration += 1
    }
}

private struct BlockFrames: PreferenceKey {
    static let defaultValue: [String:CGRect] = [:]
    static func reduce(value: inout [String:CGRect],nextValue: () -> [String:CGRect]) {
        value.merge(nextValue(),uniquingKeysWith:{ _,latest in latest })
    }
}

private struct ReadingMeasure: View {
    let id: String
    var body: some View {
        GeometryReader { geometry in
            Color.clear.preference(key:BlockFrames.self,value:[id:geometry.frame(in:.named("chapter-passage"))])
        }
    }
}

@MainActor
private final class ReaderScrollLink: ObservableObject {
    weak var scroll: UIScrollView?
    func adjust(by distance: CGFloat) -> Bool {
        guard let scroll else { return false }
        let minimum = -scroll.adjustedContentInset.top
        let maximum = max(minimum,scroll.contentSize.height-scroll.bounds.height+scroll.adjustedContentInset.bottom)
        scroll.setContentOffset(CGPoint(x:scroll.contentOffset.x,y:(scroll.contentOffset.y+distance).clamped(to:minimum...maximum)),
                                animated:false)
        return true
    }
}

private struct ScrollDiscovery: UIViewRepresentable {
    let link: ReaderScrollLink
    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        return view
    }
    func updateUIView(_ view: UIView,context: Context) {
        DispatchQueue.main.async {
            var ancestor = view.superview
            while let current = ancestor {
                if let scroll = current as? UIScrollView { link.scroll = scroll; return }
                ancestor = current.superview
            }
        }
    }
}
