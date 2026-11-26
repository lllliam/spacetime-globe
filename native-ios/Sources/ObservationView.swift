import SwiftUI

struct ObservationView: View {
    let content: AppContent
    @ObservedObject var session: SessionStore
    let observation: ObservationSession

    @StateObject private var viewport = GlobeViewport(GlobeCamera())
    @State private var fitted = false
    @State private var applied: AtlasKey?
    @State private var mapRegion: MapRegion?
    @Environment(\.accessibilityReduceMotion) private var reduced

    private var card: ObservationCard? {
        switch observation.subject {
        case .scene(let id):
            guard let scene = content.archive.scene(id) else { return nil }
            return ObservationCard(title:scene.title,question:scene.question,note:scene.note,limit:scene.limit,
                                   natural:scene.naturalOnly == true,scene:scene,frames:scene.frames)
        case .event(let id,let year):
            guard let event = content.archive.event(id), let x = event.lon, let y = event.lat else { return nil }
            let place = ScenePlace(id:event.id,name:event.regions.first ?? "相关区域",lon:x,lat:y,role:nil,
                                   precision:event.placement,note:"年表使用区域代表坐标。具体地点未收录。",evidence:nil)
            let frame = SceneFrame(id:event.id,year:year,title:event.title,note:event.annotation?.summary,dateLabel:event.date,
                                   places:[place],routes:[],focusPolities:[],evidence:nil)
            return ObservationCard(title:event.title,question:nil,note:nil,limit:"此地图用于理解史事涉及的区域。",
                                   natural:false,scene:nil,frames:[frame])
        }
    }

    var body: some View {
        if let card, let frame = card.frames.first(where:{ $0.id == observation.stage }) ?? card.frames.first {
            experience(card,frame:frame)
        } else {
            VStack(spacing:16) {
                Text("此现场的地图暂不可用")
                Button(observation.returnTitle) { session.endObservation() }
            }
            .frame(maxWidth:.infinity,maxHeight:.infinity)
            .foregroundStyle(.white)
            .background(Design.space.ignoresSafeArea())
        }
    }

    private func experience(_ card: ObservationCard,frame: SceneFrame) -> some View {
        GeometryReader { geometry in
            let request = AtlasKey(layer:card.natural || !content.atlas.hasHistory ? .terrain : .timeline,year:frame.year)
            let bottom = drawerHeight(geometry.size.height)
            let full = CGSize(width:geometry.size.width,height:geometry.size.height + geometry.safeAreaInsets.top + geometry.safeAreaInsets.bottom)
            let area = viewingArea(full,bottom:bottom + geometry.safeAreaInsets.bottom)
            let ready = applied?.year == frame.year && applied?.layer == request.layer
            ZStack {
                NativeGlobe(cache:content.map,resources:content.resources,request:request,viewport:viewport,showNames:false,
                            selected:mapRegion?.id,
                            marks:GlobeMarks(places:frame.places,routes:frame.routes,focusPolities:frame.focusPolities,
                                             selectedPlace:observation.selectedPlace),
                            protectedTop:110,protectedBottom:bottom + geometry.safeAreaInsets.bottom,
                            showPendingArt:false,haptics:session.preferences.haptics,
                            onApplied:{ key,_ in applied = key },
                            onRegions:{ mapRegion = $0.first },onPlace:{ selectPlace($0,frame:frame,size:full,area:area) })
                    .ignoresSafeArea()
                VStack(spacing:0) {
                    header(frame,ready:ready)
                    Spacer(minLength:0)
                    MapDrawer(position:drawer,available:geometry.size.height,title:card.title,
                              subtitle:frame.title == card.title ? nil : frame.title,trailing:{
                        IconAction(icon:observation.drawer == .expanded ? "chevron.down" : "chevron.up",
                                   label:observation.drawer == .expanded ? "收起现场说明" : "展开现场说明",tint:Design.quiet) {
                            withAnimation(Design.motion(reduced)) {
                                session.updateObservation(drawer:observation.drawer == .expanded ? .collapsed : .expanded)
                            }
                        }
                    },details:{
                        stageControl(card,frame:frame)
                        if ready {
                            details(card,frame:frame,size:full,area:area)
                        } else {
                            ProgressView("正在读取观察底图").tint(Design.vermilion).font(.footnote)
                        }
                    })
                    .accessibilityIdentifier("observation-drawer")
                }
            }
            .onAppear {
                guard !fitted else { return }
                viewport.camera = GlobeCamera.fitting(frame.coordinates,in:full,visible:area)
                fitted = true
                if let selected = observation.selectedPlace { selectPlace(selected,frame:frame,size:full,area:area,feedback:false) }
            }
            .onChange(of:frame.id) { _ in
                mapRegion = nil
                let positions = frame.coordinates.compactMap {
                    viewport.camera.project(longitude:$0[0],latitude:$0[1],size:full)
                }
                let visible = positions.filter(area.contains).count
                if !frame.coordinates.isEmpty && visible < max(1,positions.count / 2) {
                    viewport.camera = GlobeCamera.fitting(frame.coordinates,in:full,visible:area)
                }
            }
            .onChange(of:observation.drawer) { _ in
                viewport.camera.verticalCenter = Double(area.midY/full.height).clamped(to:0.19...0.6)
            }
        }
        .background(Design.space.ignoresSafeArea())
        .overlay(alignment:.leading) {
            EdgeReturn { session.endObservation() }.frame(width:15).accessibilityHidden(true)
        }
    }

    private func header(_ frame: SceneFrame,ready: Bool) -> some View {
        HStack(alignment:.top,spacing:8) {
            Button { session.endObservation() } label: {
                Label(observation.returnTitle,systemImage:"chevron.backward").font(.subheadline.weight(.semibold))
                    .frame(minHeight:44).contentShape(Rectangle())
            }
            .buttonStyle(.plain).foregroundStyle(.white)
            .accessibilityIdentifier("return-observation")
            Spacer()
            VStack(alignment:.trailing,spacing:2) {
                Text(frame.dateLabel ?? "\(eraYear(frame.year)) 年")
                    .font(.system(.title2,design:.serif,weight:.semibold)).lineLimit(2)
                Text(ready ? "观察年代" : "底图加载中").font(.caption).foregroundStyle(.white.opacity(0.62))
            }
            .foregroundStyle(Design.gold)
        }
        .padding(.horizontal,Design.inset).padding(.top,6)
    }

    @ViewBuilder private func stageControl(_ card: ObservationCard,frame: SceneFrame) -> some View {
        if card.frames.count > 1 {
            ScrollView(.horizontal) {
                HStack(spacing:8) {
                    ForEach(card.frames) { stage in
                        Button {
                            guard stage.id != frame.id else { return }
                            session.updateObservation(stage:stage.id)
                            if session.preferences.haptics { GlobeHaptics.selection() }
                        } label: {
                            Text(stage.title).font(.footnote.weight(.medium))
                                .padding(.horizontal,12).frame(minHeight:44)
                                .foregroundStyle(stage.id == frame.id ? Design.vermilion : Design.quiet)
                                .background(stage.id == frame.id ? Design.vermilion.opacity(0.12) : Color.clear,in:Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(stage.id == frame.id ? .isSelected : [])
                    }
                }
            }
            .scrollIndicators(.hidden)
            .accessibilityLabel("现场阶段")
        }
    }

    @ViewBuilder private func details(_ card: ObservationCard,frame: SceneFrame,size: CGSize,area: CGRect) -> some View {
        if let question = card.question { Text(question).font(.headline) }
        if let note = frame.note ?? card.note { Text(note).font(.subheadline).lineSpacing(4) }
        if let region = mapRegion { Text(region.name + " · " + region.dates).font(.footnote).foregroundStyle(Design.quiet) }
        if let selected = frame.places.first(where:{ $0.id == observation.selectedPlace }) {
            VStack(alignment:.leading,spacing:8) {
                Text(selected.name).font(.headline)
                Text(selected.precisionText).font(.caption).foregroundStyle(Design.quiet)
                if let role = selected.role { Text(role).font(.subheadline) }
                if let note = selected.note { Text(note).font(.subheadline) }
                if let refs = selected.evidence, !refs.isEmpty {
                    EvidenceDetails(evidence:refs,sources:card.scene?.sources ?? [])
                }
            }
        }
        if observation.drawer == .expanded {
            places(frame,size:size,area:area)
            if let scene = card.scene { sceneSources(scene,frame:frame) }
            legend(card,frame:frame)
            if let limit = card.limit { Text(limit).font(.footnote).foregroundStyle(Design.quiet) }
        }
    }

    @ViewBuilder private func places(_ frame: SceneFrame,size: CGSize,area: CGRect) -> some View {
        if !frame.places.isEmpty {
            Divider()
            Text("地点").font(.headline)
            ForEach(frame.places) { place in
                PaperAction(title:place.name,symbol:place.id == observation.selectedPlace ? "mappin.circle.fill" : "mappin") {
                    selectPlace(place.id,frame:frame,size:size,area:area)
                }
                if let role = place.role { Text(role).font(.footnote).foregroundStyle(Design.quiet) }
                Text(place.precisionText).font(.caption).foregroundStyle(Design.quiet)
            }
        }
    }

    @ViewBuilder private func sceneSources(_ scene: HistoryScene,frame: SceneFrame) -> some View {
        ForEach(scene.unknownPlaces ?? []) { place in
            Text(place.name + " · 位置未详").font(.subheadline)
            if let note = place.note ?? place.role { Text(note).font(.footnote).foregroundStyle(Design.quiet) }
            if let refs = place.evidence { EvidenceDetails(evidence:refs,sources:scene.sources) }
        }
        if let pair = scene.distanceBetween, pair.count == 2,
           let a = frame.places.first(where:{ $0.id == pair[0] }), let b = frame.places.first(where:{ $0.id == pair[1] }) {
            Text("\(a.name)至\(b.name)的地理直线距离约 \(distance(a,b)) 公里").font(.footnote).foregroundStyle(Design.quiet)
        }
        ForEach(frame.routes) { route in
            VStack(alignment:.leading,spacing:7) {
                Text(route.label).font(.subheadline.weight(.semibold))
                Text(route.precisionText).font(.caption).foregroundStyle(Design.quiet)
                if let note = route.note { Text(note).font(.footnote) }
                if let refs = route.evidence { EvidenceDetails(evidence:refs,sources:scene.sources) }
                if route.directed == true, let direction = route.directionEvidence, !direction.isEmpty {
                    Text("方向依据").font(.caption)
                    EvidenceDetails(evidence:direction,sources:scene.sources)
                }
            }
        }
        if !scene.sources.isEmpty {
            DisclosureGroup("史料来源") {
                EvidenceDetails(evidence:(scene.evidence ?? []) + (frame.evidence ?? []),sources:scene.sources)
                ForEach(scene.sources) { SourceLine(source:$0) }
            }
            .tint(Design.indigo)
        }
    }

    @ViewBuilder private func legend(_ card: ObservationCard,frame: SceneFrame) -> some View {
        Divider()
        Text("地图图例").font(.headline)
        if card.natural || !content.index.coverage.contains(frame.year) {
            Text("自然地形参考").font(.caption).foregroundStyle(Design.quiet)
        } else {
            Text("历史疆域底图 · \(eraYear(frame.year)) 年").font(.caption).foregroundStyle(Design.quiet)
        }
        ForEach(Array(Set(frame.routes.map(\.precisionText))).sorted(),id:\.self) { value in
            Label(value,systemImage:value == "有据路线" ? "line.diagonal" : "ellipsis").font(.caption)
        }
        ForEach(Array(Set(frame.places.map(\.precisionText))).sorted(),id:\.self) { value in
            Label(value,systemImage:value == "有定位依据" ? "circle.fill" : "circle").font(.caption)
        }
    }

    private var drawer: Binding<DrawerPosition> {
        Binding(get:{ observation.drawer },set:{ session.updateObservation(drawer:$0) })
    }

    private func selectPlace(_ id: String,frame: SceneFrame,size: CGSize,area: CGRect,feedback: Bool = true) {
        guard let place = frame.places.first(where:{ $0.id == id }) else { return }
        session.updateObservation(place:id)
        let details = viewport.camera.project(longitude:place.lon,latitude:place.lat,size:size)
        if let point = details, area.insetBy(dx:32,dy:28).contains(point) {
            // The existing viewpoint preserves the surroundings of a visible point.
        } else {
            viewport.camera.center(longitude:place.lon,latitude:place.lat,zoom:max(1.65,viewport.camera.zoom))
            viewport.camera.verticalCenter = Double(area.midY/size.height).clamped(to:0.19...0.60)
        }
        if feedback && session.preferences.haptics && id != observation.selectedPlace { GlobeHaptics.selection() }
    }

    private func drawerHeight(_ height: CGFloat) -> CGFloat {
        switch observation.drawer {
        case .collapsed: return 84
        case .summary: return min(232,height*0.31)
        case .expanded: return min(height-112,height*0.62)
        }
    }

    private func viewingArea(_ size: CGSize,bottom: CGFloat) -> CGRect {
        CGRect(x:13,y:104,width:max(0,size.width-26),height:max(45,size.height-bottom-110))
    }

    private func distance(_ a: ScenePlace,_ b: ScenePlace) -> Int {
        let delta = Double.pi/180
        let d1 = sin((a.lat-b.lat)*delta/2)
        let d2 = sin((a.lon-b.lon)*delta/2)
        let h = d1*d1 + cos(a.lat*delta)*cos(b.lat*delta)*d2*d2
        return Int((12742 * asin(sqrt(h.clamped(to:0...1)))).rounded())
    }
}

private struct ObservationCard {
    let title: String
    let question: String?
    let note: String?
    let limit: String?
    let natural: Bool
    let scene: HistoryScene?
    let frames: [SceneFrame]
}

private extension SceneFrame {
    var coordinates: [[Double]] { places.map { [$0.lon,$0.lat] } + routes.flatMap(\.coordinates) }
}
