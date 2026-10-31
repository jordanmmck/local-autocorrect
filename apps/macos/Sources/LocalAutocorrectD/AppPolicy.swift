import AppKit

/// Decides whether corrections run in a given app.
///
/// Default ON everywhere except terminals, editors and IDEs (the VS Code
/// extension already covers editors, and injecting synthetic keystrokes into a
/// terminal is a bad idea). Config `apps` overrides win either way.
enum AppPolicy {
    /// Bundle-id prefixes that are OFF unless the config turns them on.
    private static let defaultOff: [String] = [
        // Terminals
        "com.apple.Terminal",
        "com.googlecode.iterm2",
        "dev.warp.Warp",
        "com.github.wez.wezterm",
        "net.kovidgoyal.kitty",
        "org.alacritty",
        "io.alacritty",
        "com.mitchellh.ghostty",
        // Editors and IDEs
        "com.microsoft.VSCode",
        "com.visualstudio.code",
        "com.vscodium",
        "com.todesktop.230313mzl4w4u92", // Cursor
        "dev.zed.Zed",
        "com.sublimetext",
        "com.jetbrains",
        "com.apple.dt.Xcode",
        "org.vim.MacVim",
        "com.neovide.neovide",
        // Password managers: never type into these
        "com.1password",
        "com.agilebits.onepassword",
        "com.bitwarden",
        "org.keepassxc",
    ]

    static func isEnabled(bundleId: String?, config: Config) -> Bool {
        guard let bundleId else { return false }
        if let override = config.apps[bundleId] { return override }
        // Bare prefix match on purpose: real ids append variant suffixes with
        // no separator ("dev.warp.Warp-Stable", "com.sublimetext.4").
        return !defaultOff.contains { bundleId.hasPrefix($0) }
    }

    static var frontmostBundleId: String? {
        NSWorkspace.shared.frontmostApplication?.bundleIdentifier
    }
}
