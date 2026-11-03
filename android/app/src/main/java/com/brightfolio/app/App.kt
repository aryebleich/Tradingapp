@file:OptIn(ExperimentalMaterial3Api::class)

package com.brightfolio.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

private enum class Phase { Loading, SignedOut, Mfa, SignedIn }
private enum class Tab(val label: String) { Home("Home"), Trade("Trade"), Orders("Orders"), Watch("Watchlist"), More("More") }

@Composable
fun App(handoff: MutableState<String?>) {
    var phase by remember { mutableStateOf(Phase.Loading) }
    var user by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun refreshMe() {
        try {
            val me = Api.obj("/auth/me")
            val u = me.optJSONObject("user")
            user = u
            phase = when {
                u != null -> Phase.SignedIn
                me.optBoolean("mfaPending") -> Phase.Mfa
                else -> Phase.SignedOut
            }
        } catch (e: ApiException) {
            error = e.message
            phase = if (Api.token != null && e.status == 0) Phase.SignedIn.also { user = user ?: JSONObject() } else Phase.SignedOut
        }
    }
    LaunchedEffect(Unit) { if (Api.token == null) phase = Phase.SignedOut else refreshMe() }
    // Back from signing in on the website.
    LaunchedEffect(handoff.value) {
        val code = handoff.value ?: return@LaunchedEffect
        handoff.value = null
        phase = Phase.Loading
        try {
            val r = Api.post("/auth/app-exchange", JSONObject().put("code", code))
            r.optString("token").takeIf { it.isNotBlank() }?.let { Api.remember(it) }
            refreshMe()
        } catch (e: ApiException) {
            error = e.message; phase = Phase.SignedOut
        }
    }
    when (phase) {
        Phase.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        Phase.SignedOut -> SignIn(error) { scope.launch { error = null; refreshMe() } }
        Phase.Mfa -> MfaScreen(onDone = { scope.launch { refreshMe() } }, onCancel = { Api.forget(); phase = Phase.SignedOut })
        Phase.SignedIn -> Main(user ?: JSONObject(), onSignedOut = { Api.forget(); user = null; phase = Phase.SignedOut })
    }
}

// ---------------- sign in ----------------
@Composable
private fun SignIn(initialError: String?, onSignedIn: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf(initialError) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Brightfolio", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        Text("Invest and trade from your phone. Start with $100,000 of practice money.", color = MaterialTheme.colorScheme.secondary)
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(email, { email = it.trim() }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                busy = true; err = null
                scope.launch {
                    try {
                        Api.post("/auth/login", JSONObject().put("email", email).put("password", password))
                        onSignedIn()
                    } catch (e: ApiException) { err = e.message } finally { busy = false }
                }
            },
            enabled = !busy && email.contains("@") && password.isNotEmpty(),
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) { Text(if (busy) "Signing in…" else "Sign in") }
        Spacer(Modifier.height(10.dp))
        OutlinedButton(onClick = { openWeb(ctx, "/app?next=handoff#/login") }, modifier = Modifier.fillMaxWidth().height(50.dp)) { Text("Sign in with Google, GitHub or phone") }
        Spacer(Modifier.height(10.dp))
        TextButton(onClick = { openWeb(ctx, "/app?next=handoff#/register") }, modifier = Modifier.fillMaxWidth()) { Text("New here? Create a free account") }
        err?.let { Spacer(Modifier.height(8.dp)); Text(it, color = Down) }
        Spacer(Modifier.height(24.dp))
        Text("Signing in with Google, GitHub or a phone code opens the website, then brings you back to the app.", fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun MfaScreen(onDone: () -> Unit, onCancel: () -> Unit) {
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var err by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Two-factor code", fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Text("Enter the 6-digit code from your authenticator app.", color = MaterialTheme.colorScheme.secondary)
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, label = { Text("Code") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
        Spacer(Modifier.height(12.dp))
        Button(onClick = { scope.launch { try { Api.post("/auth/mfa", JSONObject().put("code", code)); onDone() } catch (e: ApiException) { err = e.message } } }, enabled = code.length == 6, modifier = Modifier.fillMaxWidth().height(50.dp)) { Text("Continue") }
        TextButton(onClick = onCancel) { Text("Cancel") }
        err?.let { Text(it, color = Down) }
    }
}

// ---------------- main ----------------
@Composable
private fun Main(user: JSONObject, onSignedOut: () -> Unit) {
    var tab by remember { mutableStateOf(Tab.Home) }
    var account by remember { mutableStateOf("paper") }
    var accounts by remember { mutableStateOf<List<JSONObject>>(listOf(JSONObject().put("id", "paper").put("name", "Paper account").put("connected", true))) }
    var tradeSymbol by remember { mutableStateOf("SPY") }
    LaunchedEffect(Unit) {
        try {
            val a = Api.arr("/accounts").objects().filter { it.optBoolean("connected") }
            if (a.isNotEmpty()) accounts = a
        } catch (_: ApiException) {}
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(tab.label, fontWeight = FontWeight.SemiBold) },
                actions = { AccountPicker(accounts, account) { account = it } },
            )
        },
        bottomBar = {
            NavigationBar {
                for (t in Tab.values()) {
                    NavigationBarItem(
                        selected = tab == t, onClick = { tab = t }, label = { Text(t.label) },
                        icon = {
                            Icon(
                                when (t) {
                                    Tab.Home -> Icons.Filled.Home; Tab.Trade -> Icons.Filled.SwapVert; Tab.Orders -> Icons.Filled.List
                                    Tab.Watch -> Icons.Filled.Star; Tab.More -> Icons.Filled.Menu
                                },
                                contentDescription = t.label,
                            )
                        },
                    )
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (tab) {
                Tab.Home -> HomeScreen(account) { tradeSymbol = it; tab = Tab.Trade }
                Tab.Trade -> TradeScreen(account, accounts.firstOrNull { it.optString("id") == account }, tradeSymbol) { tradeSymbol = it }
                Tab.Orders -> OrdersScreen(account)
                Tab.Watch -> WatchScreen { tradeSymbol = it; tab = Tab.Trade }
                Tab.More -> MoreScreen(user, onSignedOut)
            }
        }
    }
}

@Composable
private fun AccountPicker(accounts: List<JSONObject>, current: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val name = accounts.firstOrNull { it.optString("id") == current }?.optString("name") ?: "Paper account"
    TextButton(onClick = { open = true }) { Text(if (current == "paper") "Paper" else name.take(18)) }
    if (open) AlertDialog(
        onDismissRequest = { open = false },
        title = { Text("Which account?") },
        text = {
            Column {
                for (a in accounts) {
                    val id = a.optString("id")
                    Row(Modifier.fillMaxWidth().clickable { onPick(id); open = false }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text((if (id == current) "● " else "○ ") + a.optString("name"), fontWeight = if (id == current) FontWeight.Bold else FontWeight.Normal)
                        if (a.optBoolean("live")) Text("  LIVE MONEY", color = Down, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { open = false }) { Text("Close") } },
    )
}

@Composable
private fun Loadable(load: suspend () -> Unit, key: Any, content: @Composable (reload: () -> Unit) -> Unit) {
    var busy by remember(key) { mutableStateOf(true) }
    var err by remember(key) { mutableStateOf<String?>(null) }
    var n by remember(key) { mutableStateOf(0) }
    LaunchedEffect(key, n) {
        busy = true; err = null
        try { load() } catch (e: ApiException) { err = e.message } finally { busy = false }
    }
    Column(Modifier.fillMaxSize()) {
        if (busy) Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.width(24.dp).height(24.dp)) }
        err?.let { Text(it, color = Down, modifier = Modifier.padding(16.dp)) }
        content { n++ }
    }
}

@Composable
private fun Stat(label: String, value: String, color: Color = MaterialTheme.colorScheme.onSurface, modifier: Modifier = Modifier) {
    Column(modifier.padding(vertical = 6.dp)) {
        Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
        Text(value, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = color)
    }
}

private fun tone(v: Double?) = when { v == null -> Color.Unspecified; v >= 0 -> Up; else -> Down }

// ---------------- home ----------------
@Composable
private fun HomeScreen(account: String, onTrade: (String) -> Unit) {
    var data by remember(account) { mutableStateOf<JSONObject?>(null) }
    Loadable(load = { data = Api.obj("/account?account=$account") }, key = account) { reload ->
        val a = data ?: return@Loadable
        val equity = a.num("equity")
        val history = a.optJSONArray("history")?.objects()?.mapNotNull { it.num("equity") } ?: emptyList()
        val base = a.num("startCash") ?: history.firstOrNull() ?: equity
        val pnl = if (equity != null && base != null) equity - base else null
        val prev = a.num("lastEquity") ?: history.dropLast(1).lastOrNull()
        val day = if (equity != null && prev != null) equity - prev else null
        val positions = a.optJSONArray("positions")?.objects() ?: emptyList()
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(if (account == "paper") "Practice money" else if (a.optBoolean("live")) "LIVE MONEY" else "Test money", fontSize = 12.sp, color = if (a.optBoolean("live")) Down else MaterialTheme.colorScheme.secondary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            IconButton(onClick = reload) { Icon(Icons.Filled.Refresh, contentDescription = "Refresh") }
                        }
                        Text(Fmt.money(equity), fontSize = 34.sp, fontWeight = FontWeight.Bold)
                        Row {
                            Stat("Today", Fmt.signed(day), tone(day), Modifier.weight(1f))
                            Stat("Total gain / loss", Fmt.signed(pnl) + " " + Fmt.pct(if (pnl != null && base != null && base != 0.0) pnl / base * 100 else null), tone(pnl), Modifier.weight(1.4f))
                        }
                        Row {
                            Stat("Cash", Fmt.money(a.num("cash")), modifier = Modifier.weight(1f))
                            Stat("Positions", positions.size.toString(), modifier = Modifier.weight(1.4f))
                        }
                        if (history.size > 1) { Spacer(Modifier.height(8.dp)); Sparkline(history, Modifier.fillMaxWidth().height(110.dp)) }
                    }
                }
            }
            item { Text("Positions", fontWeight = FontWeight.SemiBold, fontSize = 18.sp) }
            if (positions.isEmpty()) item {
                Card { Column(Modifier.padding(16.dp)) {
                    Text("Nothing here yet.", fontWeight = FontWeight.SemiBold)
                    Text("Buy your first investment on the Trade tab. A fund like SPY (the S&P 500) is a common first choice.", color = MaterialTheme.colorScheme.secondary)
                    Spacer(Modifier.height(8.dp)); Button(onClick = { onTrade("SPY") }) { Text("Buy SPY") }
                } }
            }
            items(positions) { p ->
                val sym = p.optString("symbol")
                Card(Modifier.fillMaxWidth().clickable { onTrade(sym) }) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(sym, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                            Text("${Fmt.qty(p.num("qty"))} shares · avg ${Fmt.money(p.num("avgPrice"))}", fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text(Fmt.money(p.num("value")), fontWeight = FontWeight.SemiBold)
                            Text(Fmt.signed(p.num("pnl")), color = tone(p.num("pnl")), fontSize = 13.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Sparkline(values: List<Double>, modifier: Modifier) {
    val color = if (values.last() >= values.first()) Up else Down
    Canvas(modifier) {
        val lo = values.min(); val hi = values.max(); val span = (hi - lo).takeIf { it > 0 } ?: 1.0
        val p = Path()
        values.forEachIndexed { i, v ->
            val x = size.width * i / (values.size - 1)
            val y = (size.height * (1 - (v - lo) / span)).toFloat()
            if (i == 0) p.moveTo(x, y) else p.lineTo(x, y)
        }
        drawPath(p, color, style = Stroke(width = 4f))
        drawLine(color.copy(alpha = 0.25f), Offset(0f, size.height), Offset(size.width, size.height), 2f)
    }
}

// ---------------- trade ----------------
@Composable
private fun TradeScreen(account: String, acct: JSONObject?, symbolIn: String, onSymbol: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var symbol by remember(symbolIn) { mutableStateOf(symbolIn) }
    var side by remember { mutableStateOf("buy") }
    var byDollars by remember { mutableStateOf(true) }
    var amount by remember { mutableStateOf("") }
    var type by remember { mutableStateOf("market") }
    var limit by remember { mutableStateOf("") }
    var gtc by remember { mutableStateOf(false) }
    var quote by remember { mutableStateOf<JSONObject?>(null) }
    var msg by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf(false) }
    var review by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val live = acct?.optBoolean("live") == true

    suspend fun loadQuote() {
        if (symbol.isBlank()) return
        try {
            quote = Api.obj("/desk/quote/${symbol.uppercase()}?account=$account&side=$side")
            msg = null
        } catch (e: ApiException) { quote = null; msg = e.message; ok = false }
    }
    LaunchedEffect(symbolIn, account) { loadQuote() }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(symbol, { symbol = it.uppercase().filter { c -> c.isLetterOrDigit() || c == '.' || c == '/' }.take(12) }, label = { Text("Symbol") }, singleLine = true, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(8.dp))
            OutlinedButton(onClick = { onSymbol(symbol); scope.launch { loadQuote() } }) { Text("Quote") }
        }
        quote?.let { q ->
            Card { Column(Modifier.padding(14.dp)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(q.optString("symbol"), fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.weight(1f))
                    Text(Fmt.money(q.num("price")), fontWeight = FontWeight.Bold, fontSize = 22.sp)
                }
                val bid = q.num("bid"); val ask = q.num("ask")
                if (bid != null && ask != null) Text("Bid ${Fmt.money(bid)} · Ask ${Fmt.money(ask)}", fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
                val s = q.optJSONObject("session")
                Text((if (s?.optBoolean("open") == true) "Market open" else "Market closed: market orders run at the next open") + " · ${q.optString("source")}", fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
                val h = q.optJSONObject("holding")
                if (h != null && (h.num("qty") ?: 0.0) > 0) Text("You hold ${Fmt.qty(h.num("qty"))} shares (${Fmt.qty(h.num("available"))} free to sell)", fontSize = 13.sp)
            } }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { side = "buy" }, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = if (side == "buy") Up else MaterialTheme.colorScheme.surfaceVariant, contentColor = if (side == "buy") Color.White else MaterialTheme.colorScheme.onSurface)) { Text("Buy") }
            Button(onClick = { side = "sell" }, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = if (side == "sell") Down else MaterialTheme.colorScheme.surfaceVariant, contentColor = if (side == "sell") Color.White else MaterialTheme.colorScheme.onSurface)) { Text("Sell") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = type == "market", onClick = { type = "market" }, label = { Text("Market") })
            FilterChip(selected = type == "limit", onClick = { type = "limit"; byDollars = false }, label = { Text("Limit") })
            if (type == "market") {
                FilterChip(selected = byDollars, onClick = { byDollars = true }, label = { Text("Dollars") })
                FilterChip(selected = !byDollars, onClick = { byDollars = false }, label = { Text("Shares") })
            }
        }
        Text(
            if (type == "market") "Market: buys or sells right away at the current price." else "Limit: only at your price or better. It may not fill.",
            fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary,
        )
        OutlinedTextField(amount, { amount = it.filter { c -> c.isDigit() || c == '.' }.take(12) }, label = { Text(if (byDollars && type == "market") "Amount in dollars" else "Number of shares") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
        val held = quote?.optJSONObject("holding")?.num("available") ?: 0.0
        if (side == "sell" && held > 0) TextButton(onClick = { byDollars = false; amount = Fmt.qty(held) }) { Text("Sell all (${Fmt.qty(held)} shares)") }
        if (type == "limit") {
            OutlinedTextField(limit, { limit = it.filter { c -> c.isDigit() || c == '.' }.take(12) }, label = { Text("Limit price") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = !gtc, onClick = { gtc = false }, label = { Text("Today only") })
                FilterChip(selected = gtc, onClick = { gtc = true }, label = { Text("Until cancelled") })
            }
        }
        val amt = amount.toDoubleOrNull() ?: 0.0
        Button(onClick = { review = true }, enabled = symbol.isNotBlank() && amt > 0 && (type == "market" || (limit.toDoubleOrNull() ?: 0.0) > 0) && !busy, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Review order") }
        if (live) Text("This account uses real money.", color = Down, fontWeight = FontWeight.SemiBold)
        msg?.let { Text(it, color = if (ok) Up else Down) }
    }
    if (review) {
        val amt = amount.toDoubleOrNull() ?: 0.0
        val what = if (byDollars && type == "market") Fmt.money(amt) + " of " + symbol else Fmt.qty(amt) + " shares of " + symbol
        AlertDialog(
            onDismissRequest = { review = false },
            title = { Text("${side.replaceFirstChar { it.uppercase() }} $what?") },
            text = {
                Column {
                    Text(if (type == "market") "Market order, at the current price." else "Limit order at ${Fmt.money(limit.toDoubleOrNull())}, ${if (gtc) "until cancelled" else "today only"}.")
                    Text("Account: ${acct?.optString("name") ?: "Paper account"}")
                    if (live) Text("This sends a real order with real money.", color = Down, fontWeight = FontWeight.SemiBold)
                }
            },
            confirmButton = {
                Button(onClick = {
                    review = false; busy = true
                    scope.launch {
                        try {
                            val body = JSONObject().put("account", account).put("symbol", symbol.uppercase()).put("side", side).put("type", type)
                            if (byDollars && type == "market") body.put("notional", amt) else body.put("qty", amt)
                            if (type == "limit") body.put("limit_price", limit.toDouble()).put("time_in_force", if (gtc) "gtc" else "day")
                            val r = Api.post("/orders", body)
                            ok = true
                            msg = "Order sent: ${r.optString("status").ifBlank { "accepted" }}" + (r.num("price")?.let { " at ${Fmt.money(it)}" } ?: "")
                            amount = ""
                            loadQuote()
                        } catch (e: ApiException) { ok = false; msg = e.message } finally { busy = false }
                    }
                }) { Text("Place order") }
            },
            dismissButton = { TextButton(onClick = { review = false }) { Text("Cancel") } },
        )
    }
}

// ---------------- orders ----------------
@Composable
private fun OrdersScreen(account: String) {
    var list by remember(account) { mutableStateOf<List<JSONObject>>(emptyList()) }
    Loadable(load = { list = Api.arr("/orders?account=$account").objects() }, key = account) { reload ->
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Row(verticalAlignment = Alignment.CenterVertically) { Text("Recent orders", fontWeight = FontWeight.SemiBold, fontSize = 18.sp, modifier = Modifier.weight(1f)); IconButton(onClick = reload) { Icon(Icons.Filled.Refresh, "Refresh") } } }
            if (list.isEmpty()) item { Text("No orders yet.", color = MaterialTheme.colorScheme.secondary) }
            items(list) { o ->
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("${o.optString("side").uppercase()} ${o.optString("symbol")}", fontWeight = FontWeight.Bold, color = if (o.optString("side") == "buy") Up else Down)
                            Text(listOfNotNull(o.num("qty")?.let { Fmt.qty(it) + " sh" }, o.num("notional")?.let { Fmt.money(it) }, o.optString("source").takeIf { it.isNotBlank() }).joinToString(" · "), fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text(o.optString("status"), fontSize = 13.sp)
                            o.num("price")?.let { Text(Fmt.money(it), fontSize = 13.sp) }
                        }
                    }
                }
            }
        }
    }
}

// ---------------- watchlist ----------------
@Composable
private fun WatchScreen(onTrade: (String) -> Unit) {
    val ctx = LocalContext.current
    val store = remember { Watchlist(ctx) }
    val symbols = remember { mutableStateListOf<String>().apply { addAll(store.symbols()) } }
    val prices = remember { mutableStateOf(mapOf<String, Double?>()) }
    var add by remember { mutableStateOf("") }
    var n by remember { mutableStateOf(0) }
    LaunchedEffect(n, symbols.size) {
        val m = mutableMapOf<String, Double?>()
        for (s in symbols.toList()) m[s] = try { Api.obj("/quote/$s").num("price") } catch (_: ApiException) { null }
        prices.value = m
    }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(add, { add = it.uppercase().filter { c -> c.isLetterOrDigit() || c == '.' }.take(10) }, label = { Text("Add a symbol") }, singleLine = true, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                Button(onClick = { if (add.isNotBlank() && add !in symbols) { symbols.add(add); store.save(symbols) }; add = "" }) { Text("Add") }
                IconButton(onClick = { n++ }) { Icon(Icons.Filled.Refresh, "Refresh") }
            }
        }
        items(symbols.toList()) { s ->
            Card(Modifier.fillMaxWidth().clickable { onTrade(s) }) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(s, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    Text(Fmt.money(prices.value[s]), fontWeight = FontWeight.SemiBold)
                    TextButton(onClick = { symbols.remove(s); store.save(symbols) }) { Text("Remove") }
                }
            }
        }
    }
}

// ---------------- more ----------------
@Composable
private fun MoreScreen(user: JSONObject, onSignedOut: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val links = listOf(
        "Get started (guided setup)" to "/app#/start", "Learn: short lessons" to "/app#/learn", "S&P 500 plan" to "/app#/sp500",
        "Ready-made strategies" to "/app#/strategies", "Charts" to "/app#/chart", "Choose your brokerage" to "/app#/brokers",
        "Plans & billing" to "/app#/funding", "Settings" to "/app#/settings", "Security & help" to "/app#/security", "Everything else (full website)" to "/app",
    )
    LazyColumn(contentPadding = PaddingValues(16.dp)) {
        item {
            Text(user.optString("email").takeUnless { it.endsWith("@phone.invalid") } ?: user.optString("phone"), fontWeight = FontWeight.SemiBold)
            Text("Plan: ${user.optString("plan").ifBlank { "free" }.replaceFirstChar { it.uppercase() }}", color = MaterialTheme.colorScheme.secondary)
            Spacer(Modifier.height(12.dp))
        }
        items(links) { (t, path) ->
            Text(t, modifier = Modifier.fillMaxWidth().clickable { openWeb(ctx, path) }.padding(vertical = 14.dp), fontSize = 16.sp)
            HorizontalDivider()
        }
        item {
            Spacer(Modifier.height(16.dp))
            OutlinedButton(onClick = { scope.launch { try { Api.post("/auth/logout") } catch (_: ApiException) {}; onSignedOut() } }, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
            Spacer(Modifier.height(8.dp))
            Text("Brightfolio ${BuildConfig.VERSION_NAME}. Brightfolio is software, not a broker; brokerage accounts are held at Alpaca Securities LLC, member FINRA/SIPC.", fontSize = 11.sp, color = MaterialTheme.colorScheme.secondary)
        }
    }
}
