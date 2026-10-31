import AppKit
import Carbon.HIToolbox

/// Watches keystrokes through a CGEventTap, rebuilds the word being typed,
/// and on a boundary character asks the sidecar for a correction, which is
/// applied espanso-style: backspaces, then the replacement.
final class CorrectionController {
    private var tap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?

    /// The word currently being typed.
    private var word = ""
    /// Text typed before `word` since the last reset (context for the engine).
    private var line = ""
    /// Bumped on every real keystroke and mouse click; a stale seq cancels
    /// pending corrections and invalidates the revert window.
    private var seq: UInt64 = 0

    var enabled = true
    var config: Config
    private let sidecar: Sidecar

    struct AppliedCorrection {
        let original: String
        let replacement: String
        let boundary: String
        let seq: UInt64
        let bundleId: String?
        let at: Date
    }
    private(set) var lastCorrection: AppliedCorrection?

    /// Keycodes that end editing context: return, keypad-enter, tab, escape,
    /// forward delete, home, page up, end, page down, arrows.
    private static let resetKeyCodes: Set<Int64> = [36, 76, 48, 53, 117, 115, 116, 119, 121, 123, 124, 125, 126]
    private static let deleteKeyCode: Int64 = 51
    private static let boundaries = Set(" .,!?;:)]}\"".map { $0 })
    private static let maxWordLength = 48
    private static let maxLineLength = 256

    init(config: Config, sidecar: Sidecar) {
        self.config = config
        self.sidecar = sidecar
    }

    /// Creates and enables the event tap. Requires Accessibility permission;
    /// returns false when macOS refuses the tap.
    func start() -> Bool {
        guard tap == nil else { return true }
        let mask: CGEventMask =
            (1 << CGEventType.keyDown.rawValue)
            | (1 << CGEventType.leftMouseDown.rawValue)
            | (1 << CGEventType.rightMouseDown.rawValue)
            | (1 << CGEventType.otherMouseDown.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, userInfo in
            guard let userInfo else { return Unmanaged.passUnretained(event) }
            let controller = Unmanaged<CorrectionController>.fromOpaque(userInfo).takeUnretainedValue()
            return controller.handle(type: type, event: event)
        }
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: callback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else { return false }
        self.tap = tap
        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }

    var isRunning: Bool { tap != nil }

    func reset() {
        word = ""
        line = ""
    }

    private func handle(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        let pass = Unmanaged.passUnretained(event)
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return pass
        }
        // Skip our own synthetic events.
        if event.getIntegerValueField(.eventSourceUserData) == Injector.magic { return pass }
        switch type {
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            // A click moves the caret: cancel pending corrections and close
            // the revert window, not just the word buffer.
            seq &+= 1
            reset()
        case .keyDown:
            handleKeyDown(event)
        default:
            break
        }
        return pass
    }

    private func handleKeyDown(_ event: CGEvent) {
        let flags = event.flags
        // The revert hotkey reaches the tap before Carbon dispatches it to the
        // HotKey handler; it must not bump seq or reset, or canRevert would
        // always be false by the time revertLast() runs.
        if event.getIntegerValueField(.keyboardEventKeycode) == HotKey.revertKeyCode,
           flags.contains(.maskControl), flags.contains(.maskAlternate), !flags.contains(.maskCommand) {
            return
        }
        seq &+= 1
        // A chord (cmd-A, ctrl-K, option-anything) can move the caret or edit
        // text in ways we cannot track: drop all context.
        if !flags.intersection([.maskCommand, .maskControl, .maskAlternate]).isEmpty {
            reset()
            return
        }
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        if keyCode == Self.deleteKeyCode {
            if !word.isEmpty { word.removeLast() } else if !line.isEmpty { line.removeLast() }
            return
        }
        if Self.resetKeyCodes.contains(keyCode) {
            reset()
            return
        }
        var chars = [UniChar](repeating: 0, count: 4)
        var length = 0
        event.keyboardGetUnicodeString(maxStringLength: 4, actualStringLength: &length, unicodeString: &chars)
        guard length > 0 else { return }
        for ch in String(utf16CodeUnits: chars, count: length) {
            process(ch)
        }
    }

    private func process(_ ch: Character) {
        if ch.isNewline || (ch.asciiValue.map { $0 < 0x20 } ?? false) {
            reset()
            return
        }
        if Self.boundaries.contains(ch) {
            let completed = word
            let before = line
            line.append(word)
            line.append(ch)
            word = ""
            trimLine()
            if !completed.isEmpty {
                maybeCorrect(word: completed, before: before, boundary: String(ch))
            }
            return
        }
        // Normalize the curly apostrophe apps substitute, so "don’t" and "i’m"
        // reach the engine the way it expects them.
        word.append(ch == "\u{2019}" ? "'" : ch)
        if word.count > Self.maxWordLength {
            // Too long to ever correct; fold it into the line as ordinary text.
            line.append(word)
            word = ""
            trimLine()
        }
    }

    private func trimLine() {
        if line.count > Self.maxLineLength {
            line.removeFirst(line.count - Self.maxLineLength)
        }
    }

    private func maybeCorrect(word completed: String, before: String, boundary: String) {
        guard enabled, sidecar.ready, !IsSecureEventInputEnabled() else { return }
        let bundleId = AppPolicy.frontmostBundleId
        guard AppPolicy.isEnabled(bundleId: bundleId, config: config) else { return }
        let mySeq = seq
        sidecar.check(word: completed, before: before, after: boundary) { [weak self] replacement in
            guard let self, let replacement,
                  self.seq == mySeq, // nothing typed since the boundary
                  self.enabled,
                  AppPolicy.frontmostBundleId == bundleId,
                  !IsSecureEventInputEnabled()
            else { return }
            self.line = before + replacement + boundary
            self.lastCorrection = AppliedCorrection(
                original: completed, replacement: replacement, boundary: boundary,
                seq: mySeq, bundleId: bundleId, at: Date())
            let backspaces = completed.count + boundary.count
            DispatchQueue.global(qos: .userInteractive).async {
                Injector.replace(backspaces: backspaces, with: replacement + boundary)
            }
        }
    }

    /// True when the last correction is still untouched on screen and recent
    /// enough to undo safely.
    var canRevert: Bool {
        guard let last = lastCorrection else { return false }
        return seq == last.seq
            && Date().timeIntervalSince(last.at) < 60
            && AppPolicy.frontmostBundleId == last.bundleId
    }

    /// Re-types the original word and teaches the engine never to "fix" it
    /// again (persisted in the config, mirroring the extension's
    /// learn-from-reverts).
    @discardableResult
    func revertLast() -> Bool {
        guard canRevert, let last = lastCorrection else { return false }
        lastCorrection = nil
        reset()
        let backspaces = last.replacement.count + last.boundary.count
        let text = last.original + last.boundary
        DispatchQueue.global(qos: .userInteractive).async {
            Injector.replace(backspaces: backspaces, with: text)
        }
        sidecar.suppress(word: last.original)
        let lower = last.original.lowercased()
        if !config.learnedWords.contains(lower) {
            config.learnedWords.append(lower)
            config.save()
        }
        return true
    }
}
