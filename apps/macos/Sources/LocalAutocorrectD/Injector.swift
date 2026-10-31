import CoreGraphics
import Foundation

/// Synthesizes keystrokes: backspaces to erase the typo, then the replacement.
/// Every injected event carries a magic marker so the event tap ignores it.
enum Injector {
    /// Marks our own synthetic events in the eventSourceUserData field.
    static let magic: Int64 = 0x4C_41_43_30 // "LAC0"

    private static let backspaceKeyCode: CGKeyCode = 51

    /// Erases `backspaces` characters, then types `text`. Runs synchronously;
    /// call it off the main thread.
    static func replace(backspaces: Int, with text: String) {
        guard let source = CGEventSource(stateID: .privateState) else { return }
        for _ in 0..<backspaces {
            post(key: backspaceKeyCode, source: source)
        }
        // Chunk the replacement into events; keyboardSetUnicodeString handles
        // short strings reliably, so send a few characters per event.
        for chunk in Array(text.utf16).chunked(into: 8) {
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
            else { continue }
            down.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
            up.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
            postPair(down, up)
        }
    }

    private static func post(key: CGKeyCode, source: CGEventSource) {
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false)
        else { return }
        postPair(down, up)
    }

    private static func postPair(_ down: CGEvent, _ up: CGEvent) {
        for event in [down, up] {
            event.flags = []
            event.setIntegerValueField(.eventSourceUserData, value: magic)
            event.post(tap: .cghidEventTap)
            // Give slower apps time to process each event in order.
            usleep(1500)
        }
    }
}

extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}
