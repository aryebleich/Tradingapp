package com.brightfolio.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Accent = Color(0xFF4F7CFF)
val Up = Color(0xFF1E9E6A)
val Down = Color(0xFFD64545)

private val Light = lightColorScheme(
    primary = Accent, onPrimary = Color.White, secondary = Color(0xFF6B7A99),
    background = Color(0xFFF7F8FB), surface = Color.White, surfaceVariant = Color(0xFFEEF1F7),
)
private val Dark = darkColorScheme(
    primary = Color(0xFF7FA0FF), onPrimary = Color(0xFF0B1220), secondary = Color(0xFF9AA8C7),
    background = Color(0xFF0B1220), surface = Color(0xFF131B2E), surfaceVariant = Color(0xFF1C2640),
)

@Composable
fun BrightfolioTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
