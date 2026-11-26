import XCTest

final class JourneyTests: XCTestCase {
    @MainActor func testExploreReadObserveAndReturn() {
        let app = XCUIApplication()
        app.launch()
        let choose = app.buttons["choose-year"]
        XCTAssertTrue(choose.waitForExistence(timeout:25))
        selectYear(1499,in:app)
        selectYear(1500,in:app)
        let almanac = app.buttons["open-almanac"]
        let rendered = XCTNSPredicateExpectation(predicate:NSPredicate(format:"enabled == true"),object:almanac)
        XCTAssertEqual(XCTWaiter.wait(for:[rendered],timeout:15),.completed)

        // A sample point inside Ming on the default 1500 globe.
        app.coordinate(withNormalizedOffset:CGVector(dx:0.64,dy:0.414)).tap()
        let read = app.buttons["open-region-book"]
        XCTAssertTrue(read.waitForExistence(timeout:12))
        read.tap()
        let contents = app.buttons["reader-directory"]
        XCTAssertTrue(contents.waitForExistence(timeout:12))
        contents.tap()
        let chapter = app.buttons["chapter-founding"]
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
        XCTAssertTrue(app.otherElements["observation-drawer"].firstMatch.exists ||
                      app.staticTexts["观察年代"].waitForExistence(timeout:8))
        back.tap()
        XCTAssertTrue(contents.waitForExistence(timeout:8))
        XCTAssertTrue(visit.isHittable)
        app.buttons["close-reading"].tap()
        XCTAssertTrue(choose.waitForExistence(timeout:8))
        XCTAssertEqual(choose.value as? String,"1500 年")
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
