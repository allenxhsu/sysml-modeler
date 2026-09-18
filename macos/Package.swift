// swift-tools-version: 6.0
//
// SysML Modeler for macOS — a native shell around the web app. The model, the
// diagrams and every editing rule stay in ../src; this package supplies what a
// browser tab cannot: documents, the menu bar, save panels and PDF.

import PackageDescription

let package = Package(
    name: "SysMLModeler",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "SysMLModeler", targets: ["SysMLModeler"]),
    ],
    targets: [
        // Language mode 5: AppKit's document and WebKit's delegate APIs still
        // carry isolation annotations that Swift 6 mode rejects in practice.
        .executableTarget(
            name: "SysMLModeler",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "SysMLModelerTests",
            dependencies: ["SysMLModeler"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
