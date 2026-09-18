import XCTest
@testable import SysMLModeler

final class ShellTests: XCTestCase {
    /// The repository root, from …/macos/Tests/SysMLModelerTests/ShellTests.swift.
    private var repo: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
    }

    /// A menu item whose id the page does not know would do nothing, silently.
    func testEveryMenuCommandExistsInThePage() throws {
        let source = try String(contentsOf: repo.appendingPathComponent("src/ui/toolbar.js"), encoding: .utf8)
        let start = try XCTUnwrap(source.range(of: "export const COMMANDS = {"))
        let end = try XCTUnwrap(source.range(of: "};", range: start.upperBound..<source.endIndex))
        let table = String(source[start.upperBound..<end.lowerBound])
        let known = Set(table.matches(of: #/'([a-z]+\.[A-Za-z]+)':/#).map { String($0.1) })
        XCTAssertFalse(known.isEmpty)
        let sent = MainMenu.webCommandIDs()
        XCTAssertFalse(sent.isEmpty)
        for id in sent { XCTAssertTrue(known.contains(id), "the page has no command “\(id)”") }
    }

    func testSaveNameMatchesTheWebApp() {
        XCTAssertEqual(ModelDocument.fileName(forModelNamed: "Vehicle model"), "vehicle-model.sysml.json")
        XCTAssertEqual(ModelDocument.fileName(forModelNamed: "  Pump / v2 (draft) "), "pump-v2-draft.sysml.json")
        XCTAssertEqual(ModelDocument.fileName(forModelNamed: "…"), "untitled.sysml.json")
    }

    func testXMLIsToldFromJSON() {
        XCTAssertTrue(ModelDocument.looksLikeXML("\u{FEFF}\n <?xml version=\"1.0\"?><xmi:XMI/>"))
        XCTAssertFalse(ModelDocument.looksLikeXML("  {\"format\":\"sysml-modeler\"}"))
    }

    func testTheSchemeServesOnlyTheWebRoot() throws {
        let root = repo
        let index = try XCTUnwrap(WebRoot.file(for: URL(string: "sysml-app://app/")!, under: root))
        XCTAssertEqual(index.lastPathComponent, "index.html")
        XCTAssertTrue(FileManager.default.fileExists(atPath: index.path))
        XCTAssertNotNil(WebRoot.file(for: URL(string: "sysml-app://app/src/main.js")!, under: root))
        XCTAssertNil(WebRoot.file(for: URL(string: "sysml-app://app/../IDEF0/index.html")!, under: root))
        XCTAssertNil(WebRoot.file(for: URL(string: "sysml-app://app/src/../../secret")!, under: root))
    }

    func testModulesGetAJavaScriptType() {
        XCTAssertEqual(WebRoot.mimeType(for: URL(fileURLWithPath: "/x/main.js")), "text/javascript")
        XCTAssertEqual(WebRoot.mimeType(for: URL(fileURLWithPath: "/x/kit.css")), "text/css")
        XCTAssertEqual(WebRoot.mimeType(for: URL(fileURLWithPath: "/x/exo.woff2")), "font/woff2")
    }
}
