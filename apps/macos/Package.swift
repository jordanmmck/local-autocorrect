// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "LocalAutocorrectD",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "LocalAutocorrectD",
            path: "Sources/LocalAutocorrectD"
        )
    ]
)
