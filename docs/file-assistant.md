# Local file assistant

The assistant is off by default (`fileAssistantEnabled: false`). Enable it in Settings → Local file assistant, then explicitly download and verify Laya. Enabling alone creates no model cache and does not download or analyze files. Text excerpts have a separate default-off permission (`fileAssistantReadContent: false`).

Right-click files or the empty file list → Local file assistant, or use the command palette (⌘K). Eight tasks share one editable preview:

| Task | Input and confirmed action |
| --- | --- |
| Where does this belong? | Up to ten existing candidate directories; move or copy |
| Organize this folder | Two to ten editable categories; create category directories and move or copy |
| Assign to projects | Candidate project directories plus a description; move or copy |
| Suggest tags | Editable category vocabulary; save a chosen tag locally |
| Recommend applications | Available allowlisted local applications; open with the reviewed application |
| Refine search results | Describe needed files; select the relevant rows in the current tab |
| Check file locations | Describe folder purpose; select questionable rows for manual handling |
| Prepare a handoff | Describe recipient and goal; copy reviewed files into a chosen existing folder |

Each invocation handles at most 50 selected regular files, or the first 50 non-hidden regular files directly in the current directory. No recursive crawler, background classifier or automatic file mutation is installed. Empty candidate lists use at most ten direct child directories. Symlinks and virtual/remote paths are rejected. Files beyond the limit are reported.

Metadata includes filename, directory, extension, size and previously saved assistant tags. With explicit text permission, supported text/source files contribute at most 16 KiB. NUL-containing files, PDF, Office documents, archives and other binary formats use metadata only. Content is kept in worker/request memory, not saved in proposals on disk. This version does not perform OCR or parse PDF/Office content.

## Decision model and resources

The model chooses among supplied options; it does not generate scripts, executable paths or shell commands. Runtime is `onnxruntime-node` on CPU with two inference threads, plus the embedded Hugging Face tokenizer. No Ollama or Python service is required. Inference uses local files and has no network model loader. Only the explicit download action fetches fixed assets over HTTPS.

Pinned model: [onnx-community/laya-multilingual-ONNX](https://huggingface.co/onnx-community/laya-multilingual-ONNX), revision `46b77bbf5642fec5f14e540570228a8cbe8ab81f`, FP32 CPU graph. The download is approximately 1.326 GB (1.235 GiB); interrupted downloads can temporarily occupy additional disk space. Every asset is size- and SHA-256-verified before the ready marker is created. A cancelled download may leave a `.part` file; retry replaces that file and reuses already verified assets.

The native worker loads the model on demand and terminates after 60 seconds idle, or immediately when disabled/cancelled. Active RAM depends on runtime and input length: allow roughly 1.5–3 GB rather than treating the download size as a RAM measurement. On the development Mac, one load plus eight single-file decisions took about 1.1 seconds; this is a smoke measurement, not a hardware-independent performance promise. Disabled operation does not load weights.

Laya uses a maximum 1024-token sequence and the published choice head format. Excerpts or option descriptions can be truncated. Displayed scores are softmax model scores, **not calibrated accuracy estimates**. Scores below 0.75, truncated inputs and abstentions require review and are initially unchecked. High scores can still be wrong; every action requires an explicit confirmation. A Czech invoice smoke case sometimes abstained despite an apparently clear filename and excerpt; this is not a validated Czech document classifier. Localized built-in categories include explicit category descriptions, but arbitrary categories can still be misunderstood. Project relevance and placement checks particularly depend on useful folder names and a clear goal.

Model lineage: [ConvAI Innovations Laya Multilingual](https://huggingface.co/convaiinnovations/laya-multilingual), Apache-2.0. Sequence/tokenizer parity follows the published [open-jev Laya implementation](https://github.com/shreyaskarnik/open-jev/blob/laya-family/src/laya.ts). Model artifacts are downloaded separately, not bundled into the application. Runtime dependency licenses remain in the distributed dependency metadata.

## Persistence and confirmation

Under Electron `userData/file-assistant/`:

- `model/`: pinned tokenizer, ONNX graph, external weights and ready marker.
- `tags.json`: up to 10,000 path-keyed records, at most 16 tags per file. Tags belong to aFinder; they are not Finder tags/xattrs and do not modify document contents. Settings provides a separate delete-tags action, usable while the assistant is disabled.

Plans exist only in main-process memory, belong to the requesting window and expire after 15 minutes. Permission changes invalidate plans. The renderer can edit choices only among server-held options. Before any write, the service verifies every selected file's identity, size and modification time and pins existing target directory identities. It rechecks each operation; changed files or targets are rejected. New category directories are direct children only. File transfers use the existing keep-both collision behavior. Individual failures are shown alongside successful operations. Cancellation stops subsequent operations; an already completed move/copy is not rolled back.

Confirmed moves/copies/open operations use the existing activity recorder when that separate feature is enabled. No assistant request enables history or semantic history indexing. Tags and metadata are not sent to a cloud model.

## Verification

- `npm test`: opt-in gates, independent text permission, all eight tasks, edited previews, source preflight, owner/permission invalidation, symlink/traversal rejection, local tags, concurrent analyses and cancellation; sequence bounds and numeric normalization.
- `AFINDER_LAYA_CACHE=/path/to/verified/model npm run test:file-assistant`: disposable Electron userData; real offline CPU decisions for all modes, Settings/UI flow, editable preview, confirmed move, collision preservation and local tags. No personal files/settings are touched.
