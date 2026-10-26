import ExpoModulesCore
import QuickLook

/// Quick Look shows almost everything a phone can open, keeps zoom/swipe/playback native and, with
/// `.updateContents`, saves Markup edits into the same file, which the app then sends back to the computer.
public final class AfinderOpenModule: Module {
  private var current: Preview?

  public func definition() -> ModuleDefinition {
    Name("AfinderOpen")

    AsyncFunction("open") { (uris: [String], index: Int, editable: Bool, _: String?, promise: Promise) in
      let urls = uris.compactMap { URL(string: $0) }
      guard !urls.isEmpty, urls.indices.contains(index) else {
        throw Exception(name: "unsupported", description: "unsupported")
      }
      guard QLPreviewController.canPreview(urls[index] as NSURL) else {
        throw Exception(name: "unsupported", description: "unsupported")
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        throw Exception(name: "unsupported", description: "No view controller")
      }
      let preview = Preview(urls: urls, editable: editable) { [weak self] edited in
        self?.current = nil
        promise.resolve(["edited": edited.sorted()])
      }
      self.current = preview
      let controller = QLPreviewController()
      controller.dataSource = preview
      controller.delegate = preview
      controller.currentPreviewItemIndex = index
      presenter.present(controller, animated: true)
    }
    .runOnQueue(.main)
  }
}

private final class Preview: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
  let urls: [URL]
  let editable: Bool
  var edited = Set<Int>()
  let done: (Set<Int>) -> Void

  init(urls: [URL], editable: Bool, done: @escaping (Set<Int>) -> Void) {
    self.urls = urls
    self.editable = editable
    self.done = done
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { urls.count }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { urls[index] as NSURL }

  func previewController(_ controller: QLPreviewController, editingModeFor previewItem: QLPreviewItem) -> QLPreviewItemEditingMode {
    editable ? .updateContents : .disabled
  }

  func previewController(_ controller: QLPreviewController, didUpdateContentsOf previewItem: QLPreviewItem) {
    if let url = previewItem.previewItemURL, let i = urls.firstIndex(of: url) { edited.insert(i) }
  }

  func previewControllerDidDismiss(_ controller: QLPreviewController) { done(edited) }
}
