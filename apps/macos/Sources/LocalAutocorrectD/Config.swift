import Foundation

/// User configuration, stored as JSON at
/// ~/Library/Application Support/LocalAutocorrect/config.json.
struct Config: Codable {
    /// Engine mode: "conservative", "balanced" or "aggressive".
    var mode: String = "conservative"
    /// Absolute path to the node binary; resolved via a login shell when nil.
    var nodePath: String?
    /// Per-app overrides by bundle identifier: true forces corrections on,
    /// false forces them off. Overrides win over the built-in defaults.
    var apps: [String: Bool] = [:]
    /// Words learned from reverts: never corrected again.
    var learnedWords: [String] = []

    static var fileURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("LocalAutocorrect/config.json")
    }

    static func load() -> Config {
        guard let data = try? Data(contentsOf: fileURL),
              let config = try? JSONDecoder().decode(Config.self, from: data)
        else { return Config() }
        return config
    }

    func save() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(self) else { return }
        let url = Config.fileURL
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }
}
