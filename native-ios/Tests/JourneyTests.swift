import XCTest
import UIKit

final class JourneyTests: XCTestCase {
    @MainActor func testExploreReadObserveAndReturn() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let choose = app.buttons["choose-year"]
        XCTAssertTrue(choose.waitForExistence(timeout:25))
        selectYear(1499,in:app)
        let almanac = app.buttons["open-almanac"]
        let rendered = XCTNSPredicateExpectation(predicate:NSPredicate(format:"enabled == true"),object:almanac)
        XCTAssertEqual(XCTWaiter.wait(for:[rendered],timeout:15),.completed)

        app.buttons["explore-options"].tap()
        app.buttons["设置与关于"].tap()
        let rotation = app.switches["idle-rotation-toggle"]
        let speed = app.sliders["idle-rotation-speed"]
        XCTAssertTrue(rotation.waitForExistence(timeout:8))
        XCTAssertTrue(speed.isEnabled)
        rotation.tap()
        XCTAssertFalse(speed.isEnabled)
        rotation.tap()
        XCTAssertTrue(speed.isEnabled)
        speed.adjust(toNormalizedSliderPosition:1)
        app.buttons["关闭"].tap()

        let globe = app.descendants(matching:.any)["history-globe"].firstMatch
        XCTAssertTrue(globe.waitForExistence(timeout:8))
        capture("01-global",app)
        globe.pinch(withScale:2.3,velocity:1.5)
        capture("02-regional",app)
        globe.pinch(withScale:2.1,velocity:1.5)
        capture("03-close",app)
        globe.pinch(withScale:0.63,velocity:-1.4)
        let northStart = app.coordinate(withNormalizedOffset:CGVector(dx:0.49,dy:0.26))
        let northEnd = app.coordinate(withNormalizedOffset:CGVector(dx:0.49,dy:0.78))
        northStart.press(forDuration:0.05,thenDragTo:northEnd)
        XCTAssertTrue(choose.isHittable)
        capture("03b-north",app)
        globe.pinch(withScale:0.28,velocity:-1.25)
        capture("03c-global-return",app)
        XCTAssertEqual(choose.value as? String,"1499 年")
        app.buttons["explore-options"].tap()
        app.buttons["复位视角"].tap()
        RunLoop.current.run(until:Date().addingTimeInterval(1))
        let reset = globePixels(app)
        RunLoop.current.run(until:Date().addingTimeInterval(9))
        let idle = globePixels(app)
        XCTAssertEqual(reset.count,idle.count)
        let difference = zip(reset,idle).reduce(0.0) { $0 + abs(Double($1.0)-Double($1.1)) }
        XCTAssertGreaterThan(difference/Double(max(1,reset.count)),2,"The globe should move after resetting and leaving it idle.")
        capture("07-idle-after-reset",app)
        app.buttons["explore-options"].tap()
        app.buttons["复位视角"].tap()

        // A sample point inside Ming on the default globe orientation.
        app.coordinate(withNormalizedOffset:CGVector(dx:0.63,dy:0.425)).tap()
        let read = app.buttons["open-region-book"]
        XCTAssertTrue(read.waitForExistence(timeout:12))
        let expand = app.buttons["expand-region"]
        XCTAssertTrue(expand.isHittable)
        capture("04-compact",app)
        let compactOrigin = app.coordinate(withNormalizedOffset:CGVector(dx:0.47,dy:0.879))
        let upperScreen = app.coordinate(withNormalizedOffset:CGVector(dx:0.47,dy:0.23))
        compactOrigin.press(forDuration:0.05,thenDragTo:upperScreen)
        let collapse = app.buttons["compact-region"]
        XCTAssertTrue(collapse.waitForExistence(timeout:8))
        capture("05-full",app)
        let fullOrigin = app.coordinate(withNormalizedOffset:CGVector(dx:0.44,dy:0.28))
        let lowerScreen = app.coordinate(withNormalizedOffset:CGVector(dx:0.44,dy:0.76))
        fullOrigin.press(forDuration:0.05,thenDragTo:lowerScreen)
        XCTAssertTrue(expand.waitForExistence(timeout:8))
        read.tap()
        let contents = app.buttons["reader-directory"]
        XCTAssertTrue(contents.waitForExistence(timeout:12))
        contents.tap()
        let chapter = app.buttons["directory-chapter-founding"]
        XCTAssertTrue(chapter.waitForExistence(timeout:8))
        chapter.tap()

        let page = app.scrollViews["chapter-scroll"]
        XCTAssertTrue(page.waitForExistence(timeout:12))
        let visit = app.buttons["open-observation"].firstMatch
        for _ in 0..<10 where !visit.exists || !visit.isHittable { page.swipeUp(velocity:.slow) }
        XCTAssertTrue(visit.exists && visit.isHittable)
        visit.tap()
        let back = app.buttons["return-observation"]
        XCTAssertTrue(back.waitForExistence(timeout:12))
        XCTAssertTrue(app.buttons["expand-observation"].waitForExistence(timeout:8))
        capture("06-observe",app)
        back.tap()
        XCTAssertTrue(contents.waitForExistence(timeout:8))
        XCTAssertTrue(visit.isHittable)
        app.buttons["close-reading"].tap()
        XCTAssertTrue(choose.waitForExistence(timeout:8))
        XCTAssertEqual(choose.value as? String,"1499 年")
    }

    @MainActor private func globePixels(_ app: XCUIApplication) -> [UInt8] {
        guard let image = UIImage(data:app.screenshot().pngRepresentation)?.cgImage,
              let crop = image.cropping(to:CGRect(x:image.width/5,y:image.height/3,
                                                  width:image.width*3/5,height:image.height/4)),
              let context = CGContext(data:nil,width:48,height:48,bitsPerComponent:8,bytesPerRow:48*4,
                                      space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.noneSkipLast.rawValue),
              let data = context.data else {
            XCTFail("Could not sample the visible globe.")
            return []
        }
        context.draw(crop,in:CGRect(x:0,y:0,width:48,height:48))
        return Array(UnsafeBufferPointer(start:data.assumingMemoryBound(to:UInt8.self),count:48*48*4))
    }

    @MainActor private func capture(_ name: String,_ app: XCUIApplication) {
        let shot = XCTAttachment(screenshot:app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    @MainActor private func selectYear(_ year: Int,in app: XCUIApplication) {
        let choose = app.buttons["choose-year"]
        choose.tap()
        let field = app.textFields["year-input"]
        XCTAssertTrue(field.waitForExistence(timeout:5))
        field.tap()
        let old = field.value as? String ?? ""
        field.typeText(String(repeating:XCUIKeyboardKey.delete.rawValue,count:old.count))
        field.typeText(String(year))
        let go = app.buttons["submit-year"]
        XCTAssertTrue(go.exists)
        go.tap()
        XCTAssertTrue(choose.waitForExistence(timeout:8))
        XCTAssertEqual(choose.value as? String,"\(year) 年")
    }
}
