import AppKit
import UniformTypeIdentifiers

/// One model, one window. The page in the window holds the live model and
/// posts its JSON after every edit, so the document always has the bytes to
/// write without asking the page and waiting.
final class ModelDocument: NSDocument {
    static let jsonType = UTType.json.identifier
    static let fileSuffix = ".sysml.json"

    /// Text read from disk that the page has not been given yet.
    private(set) var pendingText: String?
    private(set) var pendingName: String?
    /// The model as the page last reported it.
    private var latestJSON: String?
    /// XMI comes in as a new model: it is never written back over the .xmi.
    private var cameFromXMI = false
    private var modelName = "Untitled model"

    override class var autosavesInPlace: Bool { false }
    override class var readableTypes: [String] { [jsonType, UTType.xml.identifier, "org.omg.xmi"] }
    override class var writableTypes: [String] { [jsonType] }
    override class func isNativeType(_ type: String) -> Bool { type == jsonType }

    private var editor: EditorWindowController? { windowControllers.first as? EditorWindowController }

    override func makeWindowControllers() {
        addWindowController(EditorWindowController())
    }

    // MARK: Reading

    override func read(from data: Data, ofType typeName: String) throws {
        guard let text = String(data: data, encoding: .utf8) else {
            throw CocoaError(.fileReadInapplicableStringEncoding)
        }
        pendingText = text
        pendingName = fileURL?.lastPathComponent
        cameFromXMI = Self.looksLikeXML(text)
        // Revert: the window already exists, so hand the text over now.
        editor?.deliverPendingText()
    }

    static func looksLikeXML(_ text: String) -> Bool {
        text.drop(while: { $0.isWhitespace || $0 == "\u{FEFF}" }).hasPrefix("<")
    }

    /// The page took the text. An imported model becomes an unsaved, untitled document.
    func didDeliverPendingText() {
        pendingText = nil
        pendingName = nil
        guard cameFromXMI else { return }
        cameFromXMI = false
        fileURL = nil
        fileType = Self.jsonType
        updateChangeCount(.changeDone)
    }

    // MARK: Changes from the page

    func pageDidChange(json: String, dirty: Bool, name: String) {
        latestJSON = json
        modelName = name
        if dirty { updateChangeCount(.changeDone) }
    }

    // MARK: Writing

    override func data(ofType typeName: String) throws -> Data {
        guard let json = latestJSON else {
            throw CocoaError(.fileWriteUnknown, userInfo: [NSLocalizedDescriptionKey: "The model has not finished loading yet. Try again in a moment."])
        }
        return Data(json.utf8)
    }

    override func prepareSavePanel(_ panel: NSSavePanel) -> Bool {
        panel.allowedContentTypes = [.json]
        panel.isExtensionHidden = false
        panel.nameFieldStringValue = Self.fileName(forModelNamed: modelName)
        return true
    }

    /// "Vehicle model" → "vehicle-model.sysml.json", the name the web app gives its downloads.
    static func fileName(forModelNamed name: String) -> String {
        let slug = name.lowercased().unicodeScalars
            .map { CharacterSet.alphanumerics.contains($0) && $0.isASCII ? String($0) : "-" }.joined()
            .split(separator: "-", omittingEmptySubsequences: true).joined(separator: "-")
        return (slug.isEmpty ? "untitled" : slug) + fileSuffix
    }

    override func save(to url: URL, ofType typeName: String, for operation: NSDocument.SaveOperationType,
                       completionHandler: @escaping (Error?) -> Void) {
        super.save(to: url, ofType: typeName, for: operation) { [weak self] error in
            if error == nil, operation != .autosaveElsewhereOperation {
                self?.editor?.documentWasSaved(as: url.lastPathComponent)
            }
            completionHandler(error)
        }
    }
}
