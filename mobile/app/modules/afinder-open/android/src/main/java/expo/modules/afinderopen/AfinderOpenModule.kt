package expo.modules.afinderopen

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Android has no Quick Look: the file goes to the app the user picks. With write permission the app
 * gets ACTION_EDIT and a writable content URI, so its changes land in our copy; JS then notices the
 * new modification time and sends the file back. Only the opened file is passed (no swiping).
 */
class AfinderOpenModule : Module() {
  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("AfinderOpen")

    AsyncFunction("open") { uris: List<String>, index: Int, editable: Boolean, mimeType: String?, promise: Promise ->
      val context = appContext.reactContext ?: throw CodedException("unsupported", "No context", null)
      val path = Uri.parse(uris.getOrNull(index) ?: throw CodedException("unsupported", "No file", null)).path
        ?: throw CodedException("unsupported", "No file", null)
      val file = File(path)
      val uri = FileProvider.getUriForFile(context, context.packageName + ".AfinderFileProvider", file)
      val type = mimeType ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "*/*"
      val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or (if (editable) Intent.FLAG_GRANT_WRITE_URI_PERMISSION else 0)
      val intent = Intent(if (editable) Intent.ACTION_EDIT else Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(flags)
      val chosen = if (editable && intent.resolveActivity(context.packageManager) == null)
        Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      else intent
      if (chosen.resolveActivity(context.packageManager) == null) throw CodedException("unsupported", "unsupported", null)
      pending?.resolve(mapOf("edited" to emptyList<Int>()))
      pending = promise
      try {
        appContext.throwingActivity.startActivityForResult(chosen, REQUEST)
      } catch (e: ActivityNotFoundException) {
        pending = null
        throw CodedException("unsupported", "unsupported", e)
      }
    }

    // Whether the file changed is decided in JS from its modification time; here we only wait for the return.
    OnActivityResult { _, (requestCode) ->
      if (requestCode == REQUEST) {
        pending?.resolve(mapOf("edited" to emptyList<Int>()))
        pending = null
      }
    }
  }

  companion object {
    private const val REQUEST = 0xaf1
  }
}
