package com.brightfolio.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.text.NumberFormat
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class ApiException(message: String, val status: Int) : Exception(message)

/** The Brightfolio API over HTTPS. The session token is kept encrypted with a key in the Android Keystore. */
object Api {
    val base: String = BuildConfig.BASE_URL
    private const val COOKIE = "qp_sid"
    private var store: TokenStore? = null

    @Volatile
    var token: String? = null
        private set

    fun init(ctx: Context) {
        if (store == null) {
            store = TokenStore(ctx.applicationContext)
            token = store?.load()
        }
    }

    fun forget() {
        token = null
        store?.clear()
    }

    fun remember(t: String) {
        token = t
        store?.save(t)
    }

    suspend fun call(method: String, path: String, body: JSONObject? = null): Any? = withContext(Dispatchers.IO) {
        val c = URL(base + "/api" + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 15000
            c.readTimeout = 30000
            c.instanceFollowRedirects = false
            c.setRequestProperty("Accept", "application/json")
            c.setRequestProperty("X-Requested-With", "qp")
            c.setRequestProperty("User-Agent", "BrightfolioAndroid/" + BuildConfig.VERSION_NAME)
            token?.let { c.setRequestProperty("Cookie", "$COOKIE=$it") }
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val status = c.responseCode
            // A new or renewed session arrives as a cookie.
            for ((k, values) in c.headerFields) {
                if (k == null || !k.equals("Set-Cookie", ignoreCase = true)) continue
                for (h in values) {
                    val m = Regex("^$COOKIE=([^;]*)").find(h) ?: continue
                    val v = m.groupValues[1]
                    if (v.isEmpty()) forget() else remember(v)
                }
            }
            val stream = if (status >= 400) c.errorStream else c.inputStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            val t = text.trim()
            val parsed: Any? = when {
                t.startsWith("{") -> runCatching { JSONObject(t) }.getOrNull()
                t.startsWith("[") -> runCatching { JSONArray(t) }.getOrNull()
                else -> null
            }
            if (status >= 400) {
                val msg = (parsed as? JSONObject)?.optString("error").orEmpty()
                throw ApiException(msg.ifBlank { "Something went wrong ($status)" }, status)
            }
            parsed
        } catch (e: IOException) {
            throw ApiException("Could not reach Brightfolio. Check your internet connection.", 0)
        } finally {
            c.disconnect()
        }
    }

    suspend fun obj(path: String): JSONObject = call("GET", path) as? JSONObject ?: JSONObject()
    suspend fun arr(path: String): JSONArray = call("GET", path) as? JSONArray ?: JSONArray()
    suspend fun post(path: String, body: JSONObject = JSONObject()): JSONObject = call("POST", path, body) as? JSONObject ?: JSONObject()
}

/** AES-GCM with a key that never leaves the phone's Keystore. */
class TokenStore(ctx: Context) {
    private val prefs = ctx.getSharedPreferences("auth", Context.MODE_PRIVATE)
    private val alias = "brightfolio-session"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore")
        ks.load(null)
        val existing = ks.getKey(alias, null) as? SecretKey
        if (existing != null) return existing
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return g.generateKey()
    }

    fun save(v: String) {
        try {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, key())
            val out = c.iv + c.doFinal(v.toByteArray())
            prefs.edit().putString("t", Base64.encodeToString(out, Base64.NO_WRAP)).apply()
        } catch (e: Exception) {
            prefs.edit().remove("t").apply()
        }
    }

    fun load(): String? {
        val s = prefs.getString("t", null) ?: return null
        return try {
            val b = Base64.decode(s, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, b, 0, 12))
            String(c.doFinal(b, 12, b.size - 12))
        } catch (e: Exception) {
            null
        }
    }

    fun clear() {
        prefs.edit().remove("t").apply()
    }
}

/** The user's own watchlist, kept on the phone. */
class Watchlist(ctx: Context) {
    private val prefs = ctx.getSharedPreferences("app", Context.MODE_PRIVATE)
    fun symbols(): List<String> = (prefs.getString("watch", null) ?: "SPY,QQQ,AAPL,MSFT").split(",").filter { it.isNotBlank() }
    fun save(list: List<String>) {
        prefs.edit().putString("watch", list.joinToString(",")).apply()
    }
}

object Fmt {
    private val usd: NumberFormat = NumberFormat.getCurrencyInstance(Locale.US)
    fun money(v: Double?): String = if (v == null || v.isNaN()) "-" else usd.format(v)
    fun signed(v: Double?): String = if (v == null || v.isNaN()) "-" else (if (v >= 0) "+" else "") + usd.format(v)
    fun pct(v: Double?): String = if (v == null || v.isNaN() || v.isInfinite()) "" else String.format(Locale.US, "%+.2f%%", v)
    fun qty(v: Double?): String = if (v == null || v.isNaN()) "-" else if (v == Math.floor(v)) v.toLong().toString() else String.format(Locale.US, "%.4f", v)
}

fun JSONObject.num(k: String): Double? = if (has(k) && !isNull(k)) optDouble(k).takeUnless { it.isNaN() } else null
fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
