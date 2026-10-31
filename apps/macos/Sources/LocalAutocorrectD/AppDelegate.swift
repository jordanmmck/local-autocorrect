import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private let sidecar = Sidecar()
    /// Owns the live Config; everything reads and writes controller.config so
    /// saves never come from a stale copy.
    private var controller: CorrectionController!
    private var hotKey: HotKey?
    private var permissionTimer: Timer?
    private var engineStatus = "starting…"
    /// The last frontmost app that isn't us, for the per-app toggle.
    private var lastExternalApp: NSRunningApplication?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = Config.load()
        controller = CorrectionController(config: config, sidecar: sidecar)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "⌨"
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu

        sidecar.onFatal = { [weak self] message in
            self?.engineStatus = message
            NSLog("LocalAutocorrectD: %@", message)
        }
        sidecar.start(config: config)

        hotKey = HotKey { [weak self] in
            self?.controller.revertLast()
        }

        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let self else { return }
            self.controller.reset()
            if let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
               app.processIdentifier != ProcessInfo.processInfo.processIdentifier {
                self.lastExternalApp = app
            }
        }

        startTapWhenPermitted()
    }

    func applicationWillTerminate(_ notification: Notification) {
        sidecar.stop()
    }

    /// Event taps need the Accessibility permission. Prompt once, then poll
    /// until the user grants it in System Settings.
    private func startTapWhenPermitted() {
        let promptKey = "AXTrustedCheckOptionPrompt" as CFString
        let trusted = AXIsProcessTrustedWithOptions([promptKey: true] as CFDictionary)
        if trusted && controller.start() { return }
        permissionTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] timer in
            guard let self else { return timer.invalidate() }
            if AXIsProcessTrusted() && self.controller.start() {
                timer.invalidate()
                self.permissionTimer = nil
            }
        }
    }

    // MARK: - Menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()

        if !controller.isRunning {
            let warning = NSMenuItem(title: "⚠︎ Accessibility permission needed", action: nil, keyEquivalent: "")
            warning.isEnabled = false
            menu.addItem(warning)
            menu.addItem(item(title: "Open Privacy & Security Settings…", action: #selector(openAccessibilitySettings)))
            menu.addItem(.separator())
        }

        let status = NSMenuItem(title: "Engine: \(sidecar.ready ? "ready (\(controller.config.mode))" : engineStatus)", action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())

        let toggle = item(title: "Enabled", action: #selector(toggleEnabled))
        toggle.state = controller.enabled ? .on : .off
        menu.addItem(toggle)

        let modeMenu = NSMenu()
        for mode in ["conservative", "balanced", "aggressive"] {
            let modeChoice = item(title: mode.capitalized, action: #selector(setMode(_:)))
            modeChoice.representedObject = mode
            modeChoice.state = controller.config.mode == mode ? .on : .off
            modeMenu.addItem(modeChoice)
        }
        let modeItem = NSMenuItem(title: "Mode", action: nil, keyEquivalent: "")
        menu.addItem(modeItem)
        menu.setSubmenu(modeMenu, for: modeItem)

        if let app = lastExternalApp, let bundleId = app.bundleIdentifier {
            let name = app.localizedName ?? bundleId
            let appToggle = item(title: "Correct in \(name)", action: #selector(toggleFrontApp))
            appToggle.state = AppPolicy.isEnabled(bundleId: bundleId, config: controller.config) ? .on : .off
            menu.addItem(appToggle)
        }

        menu.addItem(.separator())
        let revert = item(title: "Revert Last Correction (⌃⌥Z)", action: controller.canRevert ? #selector(revertLast) : nil)
        menu.addItem(revert)
        menu.addItem(.separator())
        // Quit keeps a nil target so the responder chain delivers it to
        // NSApplication; targeting self would disable the item.
        menu.addItem(NSMenuItem(title: "Quit Local Autocorrect", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }

    private func item(title: String, action: Selector?) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    @objc private func toggleEnabled() {
        controller.enabled.toggle()
        statusItem.button?.appearsDisabled = !controller.enabled
    }

    @objc private func setMode(_ sender: NSMenuItem) {
        guard let mode = sender.representedObject as? String else { return }
        controller.config.mode = mode
        controller.config.save()
        sidecar.setMode(mode)
    }

    @objc private func toggleFrontApp() {
        guard let bundleId = lastExternalApp?.bundleIdentifier else { return }
        let current = AppPolicy.isEnabled(bundleId: bundleId, config: controller.config)
        controller.config.apps[bundleId] = !current
        controller.config.save()
    }

    @objc private func revertLast() {
        controller.revertLast()
    }

    @objc private func openAccessibilitySettings() {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
        NSWorkspace.shared.open(url)
    }
}
