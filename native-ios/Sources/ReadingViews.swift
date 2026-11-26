import SwiftUI

struct ReadingView: View {
    let content: AppContent
    @ObservedObject var session: SessionStore
    let reading: ReadingSession
    @State private var auxiliary: ReaderPanel?

    private enum ReaderPanel: String, Identifiable {
        case contents, display
        var id: String { rawValue }
    }

    private var paper: ReaderPaper { session.preferences.paper }

    var body: some View {
        if let node = reading.nodes.last, let volume = content.archive.volume(node.target.volume) {
            let chapter = volume.chapter(node.target.chapter)
            VStack(spacing:0) {
                toolbar(volume,chapter:chapter)
                Rectangle().fill(paper.quiet.opacity(0.22)).frame(height:1)
                if let chapter {
                    ChapterPage(content:content,session:session,node:node,volume:volume,chapter:chapter,
                                openContents:{ auxiliary = .contents })
                        .id(node.target)
                } else {
                    VolumePage(volume:volume,node:node,bookmark:session.bookmark(for:volume),paper:paper) { chapter,start in
                        session.open(ReadingNode(volume:volume.id,chapter:chapter.id,entryYear:node.entryYear,
                                                 focusBlock:start ? "__start__" : nil))
                    }
                    .id(volume.id)
                }
            }
            .foregroundStyle(paper.text).tint(paper.link)
            .background(paper.background.ignoresSafeArea())
            .overlay(alignment:.leading) {
                EdgeReturn { session.backInReading() }.frame(width:15).accessibilityHidden(true)
            }
            .sheet(item:$auxiliary) { panel in
                switch panel {
                case .contents:
                    ChapterContents(volume:volume,current:chapter?.id,bookmark:session.bookmark(for:volume),
                                    suggestions:node.entryYear.map(volume.recommendations) ?? [],paper:paper) { target in
                        let next = ReadingNode(volume:volume.id,chapter:target.id,entryYear:node.entryYear)
                        if chapter == nil { session.open(next) } else { session.switchChapter(next) }
                        auxiliary = nil
                    }
                case .display:
                    PaperSheet(title:"阅读设置",paper:paper) {
                        ReadingSettings(preferences:$session.preferences)
                        PaperAction(title:"浏览历史书目",symbol:"books.vertical",paper:paper) {
                            auxiliary = nil
                            DispatchQueue.main.asyncAfter(deadline:.now()+0.4) { session.panel = .library }
                        }
                    }
                }
            }
        }
    }

    private func toolbar(_ volume: Volume,chapter: Chapter?) -> some View {
        HStack(spacing:0) {
            IconAction(icon:"chevron.backward",label:"返回",tint:paper.link) {
                session.backInReading()
            }
            Text(volume.title)
                .font(.system(.subheadline,design:.serif,weight:.semibold))
                .lineLimit(1).truncationMode(.tail)
                .frame(maxWidth:.infinity,alignment:.leading)
                .accessibilityAddTraits(.isHeader)
            IconAction(icon:"list.bullet",label:"目录",tint:paper.quiet) { auxiliary = .contents }
                .accessibilityIdentifier("reader-directory")
            IconAction(icon:"textformat.size",label:"阅读设置",tint:paper.quiet) { auxiliary = .display }
            IconAction(icon:"xmark",label:"合上书卷",tint:paper.quiet) { session.closeReading() }
                .accessibilityIdentifier("close-reading")
        }
        .padding(.horizontal,8)
        .frame(minHeight:50)
    }
}

private struct VolumePage: View {
    let volume: Volume
    let node: ReadingNode
    let bookmark: ReadingPosition?
    let paper: ReaderPaper
    let open: (Chapter,Bool) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:24) {
                PaperHeader(title:volume.title,subtitle:volume.dateText,paper:paper)
                    .padding(.top,21)
                    .accessibilityIdentifier("volume-title")
                if let summary = volume.summary {
                    Text(summary).font(Design.font(20)).lineSpacing(7).textSelection(.enabled)
                }
                if let scope = volume.scope ?? volume.notice {
                    Text(scope).font(.subheadline).foregroundStyle(paper.quiet).lineSpacing(3)
                }
                if let bookmarked = volume.chapter(bookmark?.chapter) {
                    VStack(alignment:.leading,spacing:5) {
                        PaperAction(title:"继续阅读",symbol:"bookmark.fill",prominent:true,paper:paper) { open(bookmarked,false) }
                            .accessibilityIdentifier("start-reading")
                        Text(bookmarked.title).font(.caption).foregroundStyle(paper.quiet)
                    }
                    if let first = volume.chapters.first {
                        PaperAction(title:"从头读",symbol:"book",paper:paper) { open(first,true) }
                    }
                } else if let first = volume.chapters.first {
                    PaperAction(title:"从头读",symbol:"book",prominent:true,paper:paper) { open(first,true) }
                        .accessibilityIdentifier("start-reading")
                }
                if let year = node.entryYear {
                    let recommendations = volume.recommendations(in:year)
                    if !recommendations.isEmpty {
                        VStack(alignment:.leading,spacing:5) {
                            Text("\(eraYear(year)) 年 · 推荐章节").font(.footnote).foregroundStyle(paper.quiet)
                            ForEach(recommendations) { chapter in
                                PaperAction(title:chapter.title,paper:paper) { open(chapter,false) }
                                    .accessibilityIdentifier("recommended-chapter")
                            }
                        }
                    }
                }
                Divider()
                Text("目录").font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                LazyVStack(alignment:.leading,spacing:0) {
                    ForEach(volume.chapters) { chapter in
                        ChapterRow(chapter:chapter,marker:chapter.id == bookmark?.chapter ? "阅读进度" : nil,paper:paper) {
                            open(chapter,false)
                        }
                    }
                }
            }
            .padding(.horizontal,Design.inset).padding(.bottom,36)
            .frame(maxWidth:620).frame(maxWidth:.infinity)
        }
        .accessibilityIdentifier("volume-page")
    }
}

private struct ChapterContents: View {
    let volume: Volume
    let current: String?
    let bookmark: ReadingPosition?
    let suggestions: [Chapter]
    let paper: ReaderPaper
    let select: (Chapter) -> Void

    var body: some View {
        PaperSheet(title:"目录",subtitle:volume.title,paper:paper) {
            ForEach(volume.chapters) { chapter in
                ChapterRow(chapter:chapter,marker:marker(chapter.id),paper:paper) { select(chapter) }
            }
        }
    }

    private func marker(_ id: String) -> String? {
        if current == id { return "正在阅读" }
        if bookmark?.chapter == id { return "阅读进度" }
        return suggestions.contains { $0.id == id } ? "入口年份推荐" : nil
    }
}

private struct ChapterRow: View {
    let chapter: Chapter
    let marker: String?
    let paper: ReaderPaper
    let action: () -> Void

    var body: some View {
        Button(action:action) {
            VStack(alignment:.leading,spacing:5) {
                Text(chapter.title).font(.body.weight(.medium)).foregroundStyle(paper.text)
                Text([chapter.dateText,marker].compactMap { $0 }.joined(separator:" · "))
                    .font(.caption).foregroundStyle(marker == nil ? paper.quiet : paper.accent)
                Rectangle().fill(paper.quiet.opacity(0.17)).frame(height:1).padding(.top,8)
            }
            .frame(maxWidth:.infinity,minHeight:48,alignment:.leading)
            .padding(.vertical,6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("chapter-" + chapter.id)
    }
}

struct ReadingSettings: View {
    @Binding var preferences: Preferences

    var body: some View {
        VStack(alignment:.leading,spacing:14) {
            Text("阅读底色").font(.footnote).foregroundStyle(preferences.paper.quiet)
            Picker("阅读底色",selection:$preferences.paper) {
                ForEach(ReaderPaper.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            Text("正文字号").font(.footnote).foregroundStyle(preferences.paper.quiet)
            Picker("正文字号",selection:$preferences.textSize) {
                ForEach(ReadingSize.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
        }
    }
}

struct PaperSheet<Body: View>: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    var subtitle: String?
    var paper = ReaderPaper.paper
    @ViewBuilder let content: Body

    var body: some View {
        VStack(spacing:0) {
            HStack(alignment:.top) {
                PaperHeader(title:title,subtitle:subtitle,paper:paper)
                IconAction(icon:"xmark",label:"关闭",tint:paper.quiet) { dismiss() }
            }
            .padding(.horizontal,Design.inset).padding(.top,24).padding(.bottom,12)
            ScrollView {
                LazyVStack(alignment:.leading,spacing:14) { content }
                    .padding(.horizontal,Design.inset).padding(.bottom,24)
            }
        }
        .frame(maxWidth:.infinity,maxHeight:.infinity)
        .background(paper.background.ignoresSafeArea())
        .foregroundStyle(paper.text).tint(paper.link)
        .preferredColorScheme(paper == .night ? .dark : .light)
    }
}
