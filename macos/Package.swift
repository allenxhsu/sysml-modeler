// swift-tools-version: 6.0
//
// SysML Modeler for macOS — a native shell around the web app. The model, the
// diagrams and every editing rule stay in ../src; the shell itself (documents,
// menu bar, save panels, PDF) is the shared ToolkitShell package in
// ../../shell-kit. This target is the app's configuration and menu table.

import PackageDescription

let package = Package(
    name: "SysMLModeler",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "SysMLModeler", targets: ["SysMLModeler"]),
    ],
    dependencies: [
        .package(name: "shell-kit", path: "../../shell-kit"),
    ],
    targets: [
        .executableTarget(
            name: "SysMLModeler",
            dependencies: [.product(name: "ToolkitShell", package: "shell-kit")],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "SysMLModelerTests",
            dependencies: ["SysMLModeler", .product(name: "ToolkitShell", package: "shell-kit")],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
