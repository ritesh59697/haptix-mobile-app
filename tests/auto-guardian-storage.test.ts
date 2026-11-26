/**
 * The auto-generated guardian key lives in secure storage, and older wallets move there.
 *
 * Builds before `utils/haptix-auto-guardian.ts` wrote the guardian's secret key as
 * plaintext hex to AsyncStorage. That key can freeze the wallet and start a recovery,
 * so these checks pin down that a new key only ever reaches the secure store, that a
 * legacy plaintext entry is moved and then deleted, that a failed move never loses
 * the key, and that the secret is only handed out after authentication.
 */
import { Keypair } from '@solana/web3.js'
import { Buffer } from 'buffer'
import {
  AutoGuardianBackends,
  LegacyStoreLike,
  SECURE_STORE_KEY_PATTERN,
  SECURE_STORE_UNAVAILABLE_MESSAGE,
  SecureStoreLike,
  createAutoGuardianStore,
  legacyKeyFor,
  secureKeyFor,
} from '../utils/haptix-auto-guardian'

let passed = 0
let failed = 0

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  PASS: ${name}`)
    passed++
  } else {
    console.error(`  FAIL: ${name}`)
    if (detail) console.error(`        Detail: ${detail}`)
    failed++
  }
}

function sameBytes(a: Uint8Array | null | undefined, b: Uint8Array): boolean {
  return !!a && Buffer.from(a).equals(Buffer.from(b))
}

interface MockSecure extends SecureStoreLike {
  data: Map<string, string>
  failWrites: boolean
}

function mockSecure(): MockSecure {
  const store: MockSecure = {
    data: new Map(),
    failWrites: false,
    async getItem(key) {
      if (!SECURE_STORE_KEY_PATTERN.test(key)) throw new Error(`invalid SecureStore key ${key}`)
      return store.data.get(key) ?? null
    },
    async setItem(key, value) {
      if (!SECURE_STORE_KEY_PATTERN.test(key)) throw new Error(`invalid SecureStore key ${key}`)
      if (store.failWrites) throw new Error('keystore write failed')
      store.data.set(key, value)
    },
  }
  return store
}

function mockLegacy(): LegacyStoreLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    async getItem(key) {
      return data.get(key) ?? null
    },
    async removeItem(key) {
      data.delete(key)
    },
  }
}

function setup(secureAvailable = true) {
  const secure = mockSecure()
  const legacy = mockLegacy()
  const backends: AutoGuardianBackends = { secure: secureAvailable ? secure : null, legacy }
  return { secure, legacy, store: createAutoGuardianStore(() => backends) }
}

const allow = async () => ({ success: true })
const deny = async () => ({ success: false, error: 'cancelled' })
const hexOf = (keypair: Keypair) => Buffer.from(keypair.secretKey).toString('hex')

async function run() {
  console.log('\n--- AUTO GUARDIAN: KEYS ---')
  {
    const guardian = Keypair.generate().publicKey.toBase58()
    assert(SECURE_STORE_KEY_PATTERN.test(secureKeyFor(guardian)), 'the SecureStore key passes the SecureStore key rule')
    assert(legacyKeyFor(guardian) === `@${secureKeyFor(guardian)}`, 'the legacy key is the pre-fix AsyncStorage key')
    let threw = false
    try {
      secureKeyFor('not/a valid key')
    } catch {
      threw = true
    }
    assert(threw, 'a guardian that would form an invalid SecureStore key is rejected')
  }

  console.log('\n--- AUTO GUARDIAN: SAVE ---')
  {
    const { secure, legacy, store } = setup()
    const keypair = Keypair.generate()
    const guardian = keypair.publicKey.toBase58()
    await store.save(keypair)
    assert(secure.data.get(secureKeyFor(guardian)) === hexOf(keypair), 'save writes the secret to the secure store')
    assert(legacy.data.size === 0, 'save writes nothing to AsyncStorage')
    assert(await store.has(guardian), 'a saved guardian is reported as held')
    const revealed = await store.reveal(guardian, allow)
    assert(revealed.ok && sameBytes(revealed.secretKey, keypair.secretKey), 'reveal returns the saved secret key')
  }
  {
    const { legacy, store } = setup(false)
    let message = ''
    try {
      await store.save(Keypair.generate())
    } catch (e: any) {
      message = e?.message ?? ''
    }
    assert(message === SECURE_STORE_UNAVAILABLE_MESSAGE, 'save throws when secure storage is unavailable')
    assert(legacy.data.size === 0, 'and does not fall back to AsyncStorage')
  }
  {
    const { secure, legacy, store } = setup()
    secure.failWrites = true
    let threw = false
    try {
      await store.save(Keypair.generate())
    } catch {
      threw = true
    }
    assert(threw, 'a failed secure write surfaces to the caller instead of being swallowed')
    assert(legacy.data.size === 0, 'and still writes nothing to AsyncStorage')
  }

  console.log('\n--- AUTO GUARDIAN: MIGRATION ---')
  {
    const { secure, legacy, store } = setup()
    const keypair = Keypair.generate()
    const guardian = keypair.publicKey.toBase58()
    legacy.data.set(legacyKeyFor(guardian), hexOf(keypair))

    assert(await store.has(guardian), 'a legacy plaintext entry is found')
    assert(secure.data.get(secureKeyFor(guardian)) === hexOf(keypair), 'it is copied into the secure store')
    assert(!legacy.data.has(legacyKeyFor(guardian)), 'and the plaintext AsyncStorage entry is deleted')

    const revealed = await store.reveal(guardian, allow)
    assert(revealed.ok && sameBytes(revealed.secretKey, keypair.secretKey), 'the migrated secret reads back intact')
    assert(await store.has(guardian), 'reading again after migration still finds the key')
  }
  {
    const { secure, legacy, store } = setup()
    const keypair = Keypair.generate()
    const guardian = keypair.publicKey.toBase58()
    legacy.data.set(legacyKeyFor(guardian), hexOf(keypair))
    secure.failWrites = true

    const revealed = await store.reveal(guardian, allow)
    assert(revealed.ok && sameBytes(revealed.secretKey, keypair.secretKey), 'a failed migration still returns the key')
    assert(legacy.data.has(legacyKeyFor(guardian)), 'and keeps the legacy entry so the key is not lost')

    secure.failWrites = false
    await store.has(guardian)
    assert(!legacy.data.has(legacyKeyFor(guardian)), 'the migration completes on the next read')
  }
  {
    const { secure, legacy, store } = setup()
    const keypair = Keypair.generate()
    const guardian = keypair.publicKey.toBase58()
    secure.data.set(secureKeyFor(guardian), hexOf(keypair))
    legacy.data.set(legacyKeyFor(guardian), hexOf(keypair))
    await store.has(guardian)
    assert(!legacy.data.has(legacyKeyFor(guardian)), 'a plaintext copy left beside a secure one is deleted')
  }
  {
    const { legacy, store } = setup(false)
    const keypair = Keypair.generate()
    const guardian = keypair.publicKey.toBase58()
    legacy.data.set(legacyKeyFor(guardian), hexOf(keypair))
    assert(await store.has(guardian), 'without secure storage a legacy key is still readable')
    assert(legacy.data.has(legacyKeyFor(guardian)), 'and is left in place rather than deleted with nowhere to go')
  }
  {
    const { secure, legacy, store } = setup()
    const guardian = Keypair.generate().publicKey.toBase58()
    const other = Keypair.generate()
    legacy.data.set(legacyKeyFor(guardian), hexOf(other))
    assert(!(await store.has(guardian)), "a legacy entry holding a different key is not treated as this guardian's")
    assert(secure.data.size === 0, 'and is not copied into the secure store')
  }

  console.log('\n--- AUTO GUARDIAN: READS ---')
  {
    const { store } = setup()
    const guardian = Keypair.generate().publicKey.toBase58()
    assert(!(await store.has(guardian)), 'a guardian with no stored secret is not held')
    const revealed = await store.reveal(guardian, allow)
    assert(!revealed.ok, 'reveal of a missing secret fails')
  }
  {
    const { secure, legacy, store } = setup()
    const keypair = Keypair.generate()
    const guardian = keypair.publicKey.toBase58()
    legacy.data.set(legacyKeyFor(guardian), hexOf(keypair))
    const revealed = await store.reveal(guardian, deny)
    assert(!revealed.ok && revealed.error === 'cancelled', 'reveal returns nothing when authentication fails')
    assert(secure.data.size === 0, 'and does not touch storage before authentication succeeds')
  }
}

run()
  .catch((e) => {
    console.error('  FAIL: unexpected error', e)
    failed++
  })
  .finally(() => {
    console.log(`\n  AUTO GUARDIAN TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
    process.exit(failed > 0 ? 1 : 0)
  })
