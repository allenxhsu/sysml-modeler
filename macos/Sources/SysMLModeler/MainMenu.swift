import AppKit
import ToolkitShell

/// The menu table. Every `web` item is a command id from `COMMANDS` in
/// src/ui/toolbar.js — the same table the web app's own menu bar runs.
enum MainMenu {
    static func build() -> NSMenu {
        ShellMenu.mainMenu(
            appMenuExtras: [ShellMenu.web("Settings…", "view.appearance", ",")] + ShellMenu.portalItems(),
            menus: [
                ShellMenu.submenu("File", ShellMenu.documentItems() + [
                    ShellMenu.web("Open the Sample Model", "file.sample"),
                    .separator(),
                ] + ShellMenu.saveItems() + [
                    .separator(),
                    ShellMenu.item("Import XMI…", #selector(NSDocumentController.openDocument(_:)), "i", [.command, .shift]),
                    ShellMenu.submenu("Export", [
                        ShellMenu.web("XMI — Model and Diagrams…", "file.exportXmi"),
                        ShellMenu.web("XMI — Model Only, for Other Tools…", "file.exportXmiModel"),
                        .separator(),
                        ShellMenu.web("This Diagram as SVG…", "export.svg"),
                        ShellMenu.web("This Diagram as PNG…", "export.png"),
                        ShellMenu.web("This Diagram as PDF…", "export.pdf", "e", [.command, .shift]),
                        ShellMenu.web("All Diagrams as PDF…", "export.pdfAll"),
                        .separator(),
                        ShellMenu.web("Everything — Every Record on This Device…", "file.exportAll"),
                    ]),
                    ShellMenu.web("Import Everything…", "file.importAll"),
                ]),
                ShellMenu.submenu("Edit", ShellMenu.editItems() + [
                    .separator(),
                    // No key equivalents: the page handles Delete itself, and a menu
                    // shortcut would take the key away from text fields.
                    ShellMenu.web("Remove from Diagram", "edit.remove"),
                    ShellMenu.web("Delete from Model", "edit.delete"),
                ]),
                ShellMenu.submenu("View", [
                    ShellMenu.web("Zoom In", "view.zoomIn", "+"),
                    ShellMenu.web("Zoom Out", "view.zoomOut", "-"),
                    ShellMenu.web("Zoom to Fit", "view.zoomFit", "0"),
                    .separator(),
                    ShellMenu.fullScreenItem(),
                ]),
                ShellMenu.submenu("Diagrams", [
                    ShellMenu.web("New Block Definition Diagram", "diagram.bdd"),
                    ShellMenu.web("New Internal Block Diagram", "diagram.ibd"),
                    ShellMenu.web("New Requirement Diagram", "diagram.req"),
                    ShellMenu.web("New Use Case Diagram", "diagram.uc"),
                    ShellMenu.web("New Package Diagram", "diagram.pkg"),
                    .separator(),
                    ShellMenu.web("New Requirement Table", "diagram.reqtable"),
                    ShellMenu.web("New Dependency Matrix…", "diagram.matrix"),
                ]),
            ],
            helpItems: [ShellMenu.web("Working with the Modeler", "help.guide", "?")])
    }
}
