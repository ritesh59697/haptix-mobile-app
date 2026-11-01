package io.haptix.mwa

import android.content.Context
import android.net.Uri
import com.solana.mobilewalletadapter.common.ProtocolContract
import com.solana.mobilewalletadapter.walletlib.association.AssociationUri
import com.solana.mobilewalletadapter.walletlib.authorization.AuthIssuerConfig
import com.solana.mobilewalletadapter.walletlib.protocol.MobileWalletAdapterConfig
import com.solana.mobilewalletadapter.walletlib.scenario.AuthorizeRequest
import com.solana.mobilewalletadapter.walletlib.scenario.AuthorizedAccount
import com.solana.mobilewalletadapter.walletlib.scenario.DeauthorizedEvent
import com.solana.mobilewalletadapter.walletlib.scenario.LocalScenario
import com.solana.mobilewalletadapter.walletlib.scenario.ReauthorizeRequest
import com.solana.mobilewalletadapter.walletlib.scenario.Scenario
import com.solana.mobilewalletadapter.walletlib.scenario.SignAndSendTransactionsRequest
import com.solana.mobilewalletadapter.walletlib.scenario.SignMessagesRequest
import com.solana.mobilewalletadapter.walletlib.scenario.SignPayloadsRequest
import com.solana.mobilewalletadapter.walletlib.scenario.SignTransactionsRequest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Owns one Mobile Wallet Adapter session.
 *
 * walletlib runs the WebSocket server, the ECDH handshake and the encrypted
 * message framing. What it cannot do is decide anything: every dApp request
 * arrives on a callback and sits there until the wallet completes it. Haptix
 * answers those with hardware passkeys, which live in JS, so each request is
 * parked in [pending] under an id, handed to JS as an event, and completed when
 * JS calls back with the user's decision.
 *
 * A dropped request would hang the dApp forever, so [tearDown] declines
 * everything still parked when the session ends.
 */
internal class HaptixMwaSession(
  private val context: Context,
  private val emit: (name: String, body: Map<String, Any?>) -> Unit,
) {
  private var scenario: Scenario? = null
  private val pending = ConcurrentHashMap<String, Any>()
  private val nextId = AtomicLong(1)

  /** Chains this wallet will authorize. Devnet-only, matching the deployed program. */
  private val supportedChains = setOf(ProtocolContract.CHAIN_SOLANA_DEVNET, ProtocolContract.CLUSTER_DEVNET)

  val isActive: Boolean
    get() = scenario != null

  /**
   * Parses an association URI and starts serving the dApp.
   *
   * Returns false when [uriString] is not an MWA association URI, which is the
   * normal case for any other deep link the app receives.
   */
  fun start(uriString: String): Boolean {
    if (scenario != null) {
      throw IllegalStateException("An MWA session is already running; end it before starting another")
    }

    val associationUri = AssociationUri.parse(Uri.parse(uriString)) ?: return false

    // createScenario picks the transport the URI asks for (local WebSocket
    // server, or a reflector for remote) and reads the port itself.
    val created = associationUri.createScenario(context, adapterConfig(), AuthIssuerConfig(ISSUER_NAME), Callbacks())
    scenario = created
    created.startAsync()
    return true
  }

  /** Declines every parked request and closes the transport. */
  fun tearDown() {
    val current = scenario ?: return
    scenario = null
    for ((_, request) in pending) {
      declineQuietly(request)
    }
    pending.clear()
    runCatching { current.close() }
  }

  // --- completion, called from JS ------------------------------------------

  fun approveAuthorize(requestId: String, publicKey: ByteArray, accountLabel: String?, walletUriBase: String?) {
    val request = take<AuthorizeRequest>(requestId)
    val account = AuthorizedAccount(
      publicKey,
      accountLabel,
      arrayOf(ProtocolContract.CHAIN_SOLANA_DEVNET),
      arrayOf(ProtocolContract.FEATURE_ID_SIGN_MESSAGES),
    )
    // signInResult is null: Sign In With Solana is not advertised yet.
    request.completeWithAuthorize(arrayOf(account), walletUriBase?.let { Uri.parse(it) }, null, null)
  }

  fun approveSignMessages(requestId: String, signedPayloads: Array<ByteArray>) {
    take<SignPayloadsRequest>(requestId).completeWithSignedPayloads(signedPayloads)
  }

  /** Declines a request by id. [take] removes it, so a later call is a no-op. */
  fun decline(requestId: String) {
    declineQuietly(pending.remove(requestId) ?: return)
  }

  private inline fun <reified T> take(requestId: String): T {
    val request = pending.remove(requestId)
      ?: throw IllegalStateException("Unknown or already-completed MWA request: $requestId")
    return request as? T
      ?: throw IllegalStateException("MWA request $requestId is a ${request.javaClass.simpleName}, not a ${T::class.java.simpleName}")
  }

  private fun declineQuietly(request: Any) {
    runCatching {
      when (request) {
        is AuthorizeRequest -> request.completeWithDecline()
        is ReauthorizeRequest -> request.completeWithDecline()
        is SignPayloadsRequest -> request.completeWithDecline()
        is SignAndSendTransactionsRequest -> request.completeWithDecline()
      }
    }
  }

  private fun park(request: Any): String {
    val id = nextId.getAndIncrement().toString()
    pending[id] = request
    return id
  }

  private fun adapterConfig() = MobileWalletAdapterConfig(
    MAX_TRANSACTIONS_PER_REQUEST,
    MAX_MESSAGES_PER_REQUEST,
    arrayOf<Any>(MobileWalletAdapterConfig.LEGACY_TRANSACTION_VERSION, 0),
    NO_CONNECTION_WARNING_TIMEOUT_MS,
    // Only what Haptix can actually honour today. signAndSendTransaction is
    // deliberately absent: the on-chain program verifies a passkey signature
    // over a message naming one recipient and amount, so it cannot yet
    // authorize an arbitrary dApp transaction. Advertising it would make every
    // such request fail after the user had already approved it.
    arrayOf(ProtocolContract.FEATURE_ID_SIGN_MESSAGES),
  )

  // --- walletlib callbacks -------------------------------------------------

  private inner class Callbacks : LocalScenario.Callbacks {
    override fun onAuthorizeRequest(request: AuthorizeRequest) {
      if (!supportedChains.contains(request.chain)) {
        request.completeWithClusterNotSupported()
        return
      }
      emit(
        EVENT_REQUEST,
        mapOf(
          "type" to "authorize",
          "requestId" to park(request),
          "identityName" to request.identityName,
          "identityUri" to request.identityUri?.toString(),
          "iconRelativeUri" to request.iconRelativeUri?.toString(),
          "chain" to request.chain,
        ),
      )
    }

    override fun onReauthorizeRequest(request: ReauthorizeRequest) {
      // The auth token walletlib issued is still valid, so the dApp is simply
      // reconnecting. Re-prompting for biometrics here would mean a passkey tap
      // every time an authorized dApp reopens.
      request.completeWithReauthorize()
    }

    override fun onSignMessagesRequest(request: SignMessagesRequest) {
      emit(
        EVENT_REQUEST,
        mapOf(
          "type" to "signMessages",
          "requestId" to park(request),
          "identityName" to request.identityName,
          "identityUri" to request.identityUri?.toString(),
          "payloads" to request.payloads.map { it.toBase64() },
        ),
      )
    }

    override fun onSignTransactionsRequest(request: SignTransactionsRequest) {
      // Deprecated in MWA 2.0 and not advertised in supportedFeatures.
      request.completeWithDecline()
    }

    override fun onSignAndSendTransactionsRequest(request: SignAndSendTransactionsRequest) {
      // See adapterConfig(): not advertised, so a spec-compliant dApp will not
      // send this. Decline rather than leave it parked if one does anyway.
      request.completeWithDecline()
    }

    override fun onDeauthorizedEvent(event: DeauthorizedEvent) {
      emit(EVENT_DEAUTHORIZED, mapOf("identityName" to event.identityName))
      event.complete()
    }

    override fun onScenarioReady() = Unit

    override fun onScenarioServingClients() {
      emit(EVENT_STATE, mapOf("state" to "serving"))
    }

    override fun onScenarioServingComplete() {
      emit(EVENT_STATE, mapOf("state" to "servingComplete"))
    }

    override fun onScenarioComplete() = Unit

    override fun onScenarioError() {
      emit(EVENT_STATE, mapOf("state" to "error"))
    }

    override fun onScenarioTeardownComplete() {
      // walletlib has released the transport. Drop our own state too, so a
      // session the dApp ended does not look active to JS.
      scenario = null
      for ((_, request) in pending) {
        declineQuietly(request)
      }
      pending.clear()
      emit(EVENT_STATE, mapOf("state" to "teardownComplete"))
    }

    override fun onLowPowerAndNoConnection() {
      emit(EVENT_STATE, mapOf("state" to "lowPowerNoConnection"))
    }
  }

  companion object {
    const val EVENT_REQUEST = "onMwaRequest"
    const val EVENT_STATE = "onMwaStateChange"
    const val EVENT_DEAUTHORIZED = "onMwaDeauthorized"

    private const val ISSUER_NAME = "Haptix"
    private const val MAX_TRANSACTIONS_PER_REQUEST = 1
    private const val MAX_MESSAGES_PER_REQUEST = 1
    private const val NO_CONNECTION_WARNING_TIMEOUT_MS = 3_000L
  }
}

private fun ByteArray.toBase64(): String = android.util.Base64.encodeToString(this, android.util.Base64.NO_WRAP)
