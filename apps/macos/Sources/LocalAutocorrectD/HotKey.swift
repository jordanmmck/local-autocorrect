import Carbon.HIToolbox

/// A global hotkey registered through Carbon's RegisterEventHotKey, which
/// works without any extra permissions.
final class HotKey {
    /// The revert binding, also recognized by the event tap so the hotkey's
    /// own keystroke doesn't disturb the correction state it acts on.
    static let revertKeyCode: Int64 = 6 // Z
    private var hotKeyRef: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?
    private let action: () -> Void

    /// Default binding: control-option-Z.
    init?(keyCode: UInt32 = UInt32(HotKey.revertKeyCode), modifiers: UInt32 = UInt32(controlKey | optionKey), action: @escaping () -> Void) {
        self.action = action
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, _, userData -> OSStatus in
                guard let userData else { return noErr }
                Unmanaged<HotKey>.fromOpaque(userData).takeUnretainedValue().action()
                return noErr
            },
            1, &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            &handlerRef)
        guard status == noErr else { return nil }
        let hotKeyID = EventHotKeyID(signature: OSType(0x4C41_4344), id: 1) // "LACD"
        guard RegisterEventHotKey(keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef) == noErr,
              hotKeyRef != nil
        else {
            if let handlerRef { RemoveEventHandler(handlerRef) }
            return nil
        }
    }

    deinit {
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        if let handlerRef { RemoveEventHandler(handlerRef) }
    }
}
