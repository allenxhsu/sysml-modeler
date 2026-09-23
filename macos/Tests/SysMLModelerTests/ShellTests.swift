import XCTest
import ToolkitShell
@testable import SysMLModeler

final class ShellTests: XCTestCase {
    override func setUp() { ShellConfig.current = SysMLApp.config }

    /// A menu item whose id the page does not know would do nothing, silently.
    func testEveryMenuCommandExistsInThePage() throws {
        let source = try String(contentsOf: SysMLApp.repositoryRoot.appendingPathComponent("src/ui/toolbar.js"), encoding: .utf8)
        let known = ShellMenu.commandIDs(inJavaScript: source)
        XCTAssertFalse(known.isEmpty)
        let sent = ShellMenu.webCommandIDs(in: MainMenu.build())
        XCTAssertFalse(sent.isEmpty)
        for id in sent { XCTAssertTrue(known.contains(id), "the page has no command “\(id)”") }
    }

    func testTheKitServesThisRepository() {
        let index = WebRoot.file(for: URL(string: "sysml-app://app/")!, under: SysMLApp.repositoryRoot)
        XCTAssertTrue(FileManager.default.fileExists(atPath: index!.path))
        XCTAssertEqual(WebDocument.fileName(forModelNamed: "Vehicle model"), "vehicle-model.sysml.json")
    }
}
