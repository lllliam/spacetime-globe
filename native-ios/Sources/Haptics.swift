import UIKit

@MainActor
enum GlobeHaptics {
    private static let selector = UISelectionFeedbackGenerator()
    private static let impact = UIImpactFeedbackGenerator(style: .soft)

    static func prepareSelection() { selector.prepare() }

    static func selection() {
        selector.selectionChanged()
        selector.prepare()
    }

    static func boundary() { impact.impactOccurred(intensity: 0.48) }
}
