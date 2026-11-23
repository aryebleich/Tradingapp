package com.brightfolio.app

import kotlin.math.min

/**
 * The server's "busy" answer (load shedding, src/reliability.js): a 503 with {"shed": true} and a
 * Retry-After header. It is never an order, a risk check or sign-in, and a refused call did not run,
 * so it is tried again quietly, like the website does (public/shed-retry.js): after the wait the
 * server asks for (at most 8 seconds), a little longer each time, up to 3 times. Only then does the
 * screen show [TEXT], with a Try again button. Plain Kotlin, so it is tested on the JVM.
 */
object Shed {
    const val TEXT = "This is taking longer than usual. Trying again…"
    const val TRIES = 3
    private val FLAG = Regex("\"shed\"\\s*:\\s*true")

    fun isShed(status: Int, body: String?): Boolean = status == 503 && body != null && FLAG.containsMatchIn(body)

    /** Milliseconds to wait before retry number [attempt] (0, 1, 2), plus [jitter]. */
    fun waitMs(retryAfter: String?, attempt: Int, jitter: Long = 0): Long {
        val seconds = retryAfter?.trim()?.toIntOrNull()?.takeIf { it > 0 } ?: 2
        return (min(8, seconds) * 1000.0 * (1 + attempt * 0.5)).toLong() + jitter
    }
}

/**
 * The legal links and disclaimer, worded exactly as the website's footer (public/app.html), shown
 * once in the app: on the More tab, under "About". LegalTest checks the wording against the site.
 */
object Legal {
    const val DISCLAIMER = "Trading involves risk of loss. Backtests and projections are hypothetical and do not guarantee future results. " +
        "Brightolio is software, not a broker or investment adviser; orders go to the brokerage account you choose."
    val LINKS = listOf("Terms" to "/terms", "Privacy" to "/privacy", "Risk Disclosure" to "/risk", "Support" to "/contact")
}
