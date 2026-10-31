import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private var config = Config.load()
    private let sidecar = Sidecar()
    private var controller: CorrectionController!
    private var hotKey: HotKey?
    private var permissionTimer: Timer?
    private var engineStatus = "starting…"
    /// The last frontmost app that isn't us, for the per-app toggle.
    private var lastExternalApp: NSRunningApplication?

    func applicationDidFinishLaunching(_ notification: Notification) {
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
            menu.addItem(NSMenuItem(title: "Open Privacy & Security Settings…", action: #selector(openAccessibilitySettings), keyEquivalent: ""))
            menu.addItem(.separator())
        }

        let status = NSMenuItem(title: "Engine: \(sidecar.ready ? "ready (\(config.mode))" : engineStatus)", action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())

        let toggle = NSMenuItem(title: "Enabled", action: #selector(toggleEnabled), keyEquivalent: "")
        toggle.state = controller.enabled ? .on : .off
        menu.addItem(toggle)

        let modeMenu = NSMenu()
        for mode in ["conservative", "balanced", "aggressive"] {
            let item = NSMenuItem(title: mode.capitalized, action: #selector(setMode(_:)), keyEquivalent: "")
            item.representedObject = mode
            item.state = config.mode == mode ? .on : .off
            modeMenu.addItem(item)
        }
        let modeItem = NSMenuItem(title: "Mode", action: nil, keyEquivalent: "")
        menu.addItem(modeItem)
        menu.setSubmenu(modeMenu, for: modeItem)

        if let app = lastExternalApp, let bundleId = app.bundleIdentifier {
            let name = app.localizedName ?? bundleId
            let appToggle = NSMenuItem(title: "Correct in \(name)", action: #selector(toggleFrontApp), keyEquivalent: "")
            appToggle.state = AppPolicy.isEnabled(bundleId: bundleId, config: config) ? .on : .off
            menu.addItem(appToggle)
        }

        menu.addItem(.separator())
        let revert = NSMenuItem(title: "Revert Last Correction (⌃⌥Z)", action: controller.canRevert ? #selector(revertLast) : nil, keyEquivalent: "")
        menu.addItem(revert)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Local Autocorrect", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        for item in menu.items where item.action != nil && item.target == nil {
            item.target = self
        }
    }

    @objc private func toggleEnabled() {
        controller.enabled.toggle()
        statusItem.button?.appearsDisabled = !controller.enabled
    }

    @objc private func setMode(_ sender: NSMenuItem) {
        guard let mode = sender.representedObject as? String else { return }
        config.mode = mode
        config.save()
        controller.config = config
        sidecar.setMode(mode)
    }

    @objc private func toggleFrontApp() {
        guard let bundleId = lastExternalApp?.bundleIdentifier else { return }
        let current = AppPolicy.isEnabled(bundleId: bundleId, config: config)
        config.apps[bundleId] = !current
        config.save()
        controller.config = config
    }

    @objc private func revertLast() {
        controller.revertLast()
    }

    @objc private func openAccessibilitySettings() {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
        NSWorkspace.shared.open(url)
    }
}
