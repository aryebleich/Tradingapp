package com.brightfolio.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The server's "busy" answer is retried quietly (Shed), like the website's public/shed-retry.js. */
class ShedTest {
    @Test fun recognisesOnlyAShed503() {
        assertTrue(Shed.isShed(503, """{"error":"This is taking longer than usual. Trying again…","shed":true,"retryAfter":4}"""))
        assertTrue(Shed.isShed(503, """{"shed": true}"""))
        assertFalse("a plain 503 is a real error", Shed.isShed(503, """{"error":"down"}"""))
        assertFalse("shed false", Shed.isShed(503, """{"shed":false}"""))
        assertFalse("only 503", Shed.isShed(429, """{"shed":true}"""))
        assertFalse(Shed.isShed(503, null))
    }

    @Test fun waitsWhatTheServerAsksAtMost8sLongerEachTime() {
        assertEquals(4000, Shed.waitMs("4", 0))
        assertEquals(6000, Shed.waitMs("4", 1))
        assertEquals(8000, Shed.waitMs("4", 2))
        assertEquals("capped at 8 s", 8000, Shed.waitMs("120", 0))
        assertEquals("no header: 2 s", 2000, Shed.waitMs(null, 0))
        assertEquals("bad header: 2 s", 2000, Shed.waitMs("soon", 0))
        assertEquals(4250, Shed.waitMs("4", 0, 250))
    }

    @Test fun triesThreeTimesWithTheSiteWording() {
        assertEquals(3, Shed.TRIES)
        assertEquals("This is taking longer than usual. Trying again…", Shed.TEXT)
        assertEquals(Shed.TEXT, readSite("src/reliability.js").let { Regex("SHED_MESSAGE = '([^']+)'").find(it)!!.groupValues[1] })
    }
}

/** The app shows the website's disclaimer and links once, with the same wording (public/app.html). */
class LegalTest {
    @Test fun sameWordingAsTheSiteFooter() {
        val html = readSite("public/app.html")
        val footer = Regex("<footer>([\\s\\S]*?)</footer>").find(html)!!.groupValues[1]
        val text = footer.replace(Regex("<[^>]+>"), " ").replace(Regex("\\s+"), " ")
        assertTrue("the footer holds the app's disclaimer", text.contains(Legal.DISCLAIMER))
        for ((label, path) in Legal.LINKS) assertTrue("$label → $path", footer.contains("<a href=\"$path\">$label</a>"))
        assertEquals(4, Legal.LINKS.size)
    }

    @Test fun shownOnceInTheApp() {
        val sources = java.io.File("src/main/java").walkTopDown().filter { it.extension == "kt" }.toList()
        val uses = sources.sumOf { Regex("Legal\\.DISCLAIMER").findAll(it.readText()).count() }
        assertEquals("Legal.DISCLAIMER is shown in exactly one place", 1, uses)
        assertTrue("no other copy of the wording", sources.none { it.name != "Net.kt" && it.readText().contains("not a broker") })
    }
}

/** A file of the website, from the repository root (the tests run in android/app). */
fun readSite(rel: String): String {
    var dir: java.io.File? = java.io.File("").absoluteFile
    while (dir != null && !java.io.File(dir, rel).exists()) dir = dir.parentFile
    return java.io.File(dir ?: error("$rel not found"), rel).readText()
}
