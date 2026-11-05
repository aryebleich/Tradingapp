package com.brightfolio.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.mutableStateOf

class MainActivity : ComponentActivity() {
    /** A sign-in code handed back by the browser (brightfolio://signin?code=...). */
    private val handoff = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Api.init(this)
        readCode(intent)
        setContent { BrightolioTheme { App(handoff) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        readCode(intent)
    }

    private fun readCode(i: Intent?) {
        val d = i?.data ?: return
        if (d.scheme == "brightfolio" && d.host == "signin") handoff.value = d.getQueryParameter("code")
    }
}

/** Opens a page of the website in the phone's browser tab, inside the app. */
fun openWeb(ctx: Context, path: String) {
    val url = if (path.startsWith("http")) path else Api.base + path
    try {
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(ctx, Uri.parse(url))
    } catch (e: Exception) {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }
}
