import AppKit
import ToolkitShell

/// The whole app: ToolkitShell's shell around the web app in ../../../src,
/// configured for SysML Modeler. XMI opens as an untitled model (the kit's
/// default import rule: anything XML), and only .sysml.json is ever written.
final class ModelDocument: WebDocument {}

enum SysMLApp {
    /// …/macos/Sources/SysMLModeler/App.swift → the repository root.
    static let repositoryRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    static let config = ShellConfig(
        appName: "SysML Modeler", handlerName: "sysml", scheme: "sysml-app", fileSuffix: ".sysml.json",
        documentNoun: "model", importedTypes: ["public.xml", "org.omg.xmi"], defaultPDFName: "diagrams.pdf",
        repositoryRoot: repositoryRoot, windowFrameAutosaveName: "SysMLEditor")
}

@main
enum SysMLModelerApp {
    static func main() {
        ShellApp.run(config: SysMLApp.config) { MainMenu.build() }
    }
}
