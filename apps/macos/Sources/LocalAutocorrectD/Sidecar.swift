import Foundation

/// Spawns the Node sidecar (sidecar/main.ts) and speaks JSON lines to it over
/// stdin/stdout. All replies are delivered on the main queue.
final class Sidecar {
    private var process: Process?
    private let stdinPipe = Pipe()
    private let stdoutPipe = Pipe()
    private var buffer = Data()
    private var nextId = 1
    private var pending: [Int: (String?) -> Void] = [:]
    private let queue = DispatchQueue(label: "sidecar")
    private(set) var ready = false
    var onFatal: ((String) -> Void)?

    /// Resolved at compile time; fine for a locally built prototype. Can be
    /// overridden with the LOCAL_AUTOCORRECT_SIDECAR environment variable.
    private static var scriptPath: String {
        if let override = ProcessInfo.processInfo.environment["LOCAL_AUTOCORRECT_SIDECAR"] { return override }
        return URL(fileURLWithPath: #filePath) // …/Sources/LocalAutocorrectD/Sidecar.swift
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("sidecar/main.ts").path
    }

    /// The menu-bar app does not inherit a login shell's PATH, so ask zsh.
    private static func findNode(config: Config) -> String? {
        if let path = config.nodePath, FileManager.default.isExecutableFile(atPath: path) { return path }
        for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
        where FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
        let probe = Process()
        probe.executableURL = URL(fileURLWithPath: "/bin/zsh")
        probe.arguments = ["-lc", "command -v node"]
        let out = Pipe()
        probe.standardOutput = out
        probe.standardError = FileHandle.nullDevice
        guard (try? probe.run()) != nil else { return nil }
        probe.waitUntilExit()
        let path = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (path?.isEmpty == false) ? path : nil
    }

    func start(config: Config) {
        guard let node = Sidecar.findNode(config: config) else {
            onFatal?("node not found — install Node >= 22.18 or set nodePath in \(Config.fileURL.path)")
            return
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [Sidecar.scriptPath]
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = FileHandle.standardError
        process.terminationHandler = { [weak self] proc in
            guard let self else { return }
            self.failPending()
            DispatchQueue.main.async {
                // Deliberate stop() clears this handler, so any exit that
                // lands here deserves a report — a clean exit before ready
                // included, or the menu stays on "starting…" forever.
                let when = self.ready ? "" : " before it was ready"
                self.ready = false
                self.onFatal?("correction engine exited\(when) (status \(proc.terminationStatus))")
            }
        }
        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard let self else { return }
            guard !data.isEmpty else {
                // EOF: without this the handler is re-invoked in a tight loop.
                handle.readabilityHandler = nil
                self.failPending()
                return
            }
            self.queue.async { self.consume(data) }
        }
        do {
            try process.run()
            self.process = process
        } catch {
            onFatal?("failed to start node sidecar: \(error.localizedDescription)")
            return
        }
        send(["cmd": "configure", "mode": config.mode, "learnedWords": config.learnedWords])
    }

    func stop() {
        process?.terminationHandler = nil
        process?.terminate()
    }

    /// Asks the engine for a correction; calls back with the replacement or nil.
    func check(word: String, before: String, after: String, completion: @escaping (String?) -> Void) {
        queue.async {
            let id = self.nextId
            self.nextId += 1
            self.pending[id] = completion
            self.write(["id": id, "cmd": "check", "word": word, "before": before, "after": after])
        }
    }

    /// Resolves every waiting check() with "no correction" when the sidecar dies.
    private func failPending() {
        queue.async {
            let completions = self.pending.values
            self.pending.removeAll()
            DispatchQueue.main.async { completions.forEach { $0(nil) } }
        }
    }

    func suppress(word: String) { send(["cmd": "suppress", "word": word]) }
    func setMode(_ mode: String) { send(["cmd": "setMode", "mode": mode]) }

    private func send(_ message: [String: Any]) {
        queue.async { self.write(message) }
    }

    /// Must run on `queue`.
    private func write(_ message: [String: Any]) {
        guard var data = try? JSONSerialization.data(withJSONObject: message) else { return }
        data.append(0x0A)
        try? stdinPipe.fileHandleForWriting.write(contentsOf: data)
    }

    /// Must run on `queue`.
    private func consume(_ data: Data) {
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = buffer.prefix(upTo: newline)
            buffer.removeSubrange(...newline)
            guard let json = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
            if json["ready"] as? Bool == true {
                DispatchQueue.main.async { self.ready = true }
                continue
            }
            if let fatal = json["fatal"] as? String {
                DispatchQueue.main.async { self.onFatal?(fatal) }
                continue
            }
            guard let id = json["id"] as? Int, let completion = pending.removeValue(forKey: id) else { continue }
            let replacement = json["replacement"] as? String
            DispatchQueue.main.async { completion(replacement) }
        }
    }
}
