package io.haptix.mwa

import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge for the wallet-side Mobile Wallet Adapter session.
 *
 * Haptix authorizes with hardware passkeys, and those live in JS. So this
 * module keeps no policy of its own: it starts a session, forwards each dApp
 * request to JS as an event, and completes the parked request when JS answers.
 */
class HaptixMwaModule : Module() {
  private var session: HaptixMwaSession? = null

  override fun definition() = ModuleDefinition {
    Name("HaptixMwa")

    Events(
      HaptixMwaSession.EVENT_REQUEST,
      HaptixMwaSession.EVENT_STATE,
      HaptixMwaSession.EVENT_DEAUTHORIZED,
    )

    /**
     * Starts serving the dApp that sent [uri].
     *
     * Returns false when [uri] is not an MWA association URI, so the caller can
     * pass every incoming deep link here without pre-filtering.
     */
    AsyncFunction("startSession") { uri: String ->
      val existing = session
      if (existing != null && existing.isActive) {
        throw MwaSessionAlreadyActiveException()
      }
      val created = HaptixMwaSession(appContext.reactContext ?: throw MwaNoContextException()) { name, body ->
        sendEvent(name, body)
      }
      session = created
      runCatching { created.start(uri) }
        .onFailure {
          session = null
          throw it
        }
        .getOrThrow()
    }

    AsyncFunction("endSession") {
      session?.tearDown()
      session = null
    }

    Function("isSessionActive") {
      session?.isActive == true
    }

    /**
     * Approves an authorize request with the wallet account the dApp may use.
     *
     * [publicKeyBase64] is the Haptix smart wallet PDA, not the passkey: that
     * PDA is what owns funds on chain and what a dApp must address.
     */
    AsyncFunction("approveAuthorize") { requestId: String, publicKeyBase64: String, accountLabel: String?, walletUriBase: String? ->
      withSession { it.approveAuthorize(requestId, publicKeyBase64.decodeBase64(), accountLabel, walletUriBase) }
    }

    /** Completes a signMessages request with one signature per requested payload, in order. */
    AsyncFunction("approveSignMessages") { requestId: String, signaturesBase64: List<String> ->
      withSession { session ->
        val signatures = signaturesBase64.map { it.decodeBase64() }.toTypedArray()
        session.approveSignMessages(requestId, signatures)
      }
    }

    /** Declines a request. The dApp sees a user-rejected error. */
    AsyncFunction("declineRequest") { requestId: String ->
      withSession { it.decline(requestId) }
    }

    OnDestroy {
      // The activity is going away; a dApp waiting on a parked request would
      // otherwise hang until its own timeout.
      session?.tearDown()
      session = null
    }
  }

  private inline fun withSession(block: (HaptixMwaSession) -> Unit) {
    val current = session ?: throw MwaNoSessionException()
    try {
      block(current)
    } catch (e: IllegalStateException) {
      throw MwaRequestStateException(e.message ?: "MWA request could not be completed")
    }
  }
}

private fun String.decodeBase64(): ByteArray =
  try {
    Base64.decode(this, Base64.DEFAULT)
  } catch (e: IllegalArgumentException) {
    throw MwaInvalidBase64Exception()
  }

internal class MwaSessionAlreadyActiveException :
  CodedException("An MWA session is already running; call endSession() first")

internal class MwaNoSessionException :
  CodedException("No MWA session is running")

internal class MwaNoContextException :
  CodedException("No Android context is available to host an MWA session")

internal class MwaInvalidBase64Exception :
  CodedException("Expected base64-encoded bytes")

internal class MwaRequestStateException(message: String) : CodedException(message)
