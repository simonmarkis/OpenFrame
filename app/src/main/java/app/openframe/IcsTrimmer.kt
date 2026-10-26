package app.openframe

/**
 * Drops VEVENTs that can't appear in any view from or after [cutoff], so the WebView parses
 * a fraction of a long-lived feed. Pure Kotlin (unit-tested on the JVM).
 *
 * Kept: recurring masters whose RRULE has no UNTIL or ends on/after the cutoff, anything with
 * RDATE, and single events / overrides ending on/after the cutoff. Everything outside VEVENTs
 * (VTIMEZONE, calendar properties) is kept unchanged. Dates are compared as YYYYMMDD without
 * time zones, so the caller's cutoff should include a margin.
 */
object IcsTrimmer {

    data class Result(val text: String, val kept: Int, val dropped: Int)

    private val DATE8 = Regex("(\\d{8})")
    private val UNTIL = Regex("UNTIL=(\\d{8})", RegexOption.IGNORE_CASE)

    /** @param cutoff "yyyyMMdd" */
    fun trim(ics: String, cutoff: String): Result {
        val out = StringBuilder(ics.length / 2)
        val block = ArrayList<String>()
        var inEvent = false
        var kept = 0
        var dropped = 0
        for (line in unfold(ics)) {
            if (!inEvent) {
                if (line.equals("BEGIN:VEVENT", ignoreCase = true)) {
                    inEvent = true
                    block.clear()
                    block += line
                } else if (line.isNotEmpty()) {
                    out.append(line).append("\r\n")
                }
                continue
            }
            block += line
            if (line.equals("END:VEVENT", ignoreCase = true)) {
                inEvent = false
                if (keep(block, cutoff)) {
                    block.forEach { out.append(it).append("\r\n") }
                    kept++
                } else {
                    dropped++
                }
            }
        }
        // Unterminated VEVENT at the end: pass it through and let the parser report it.
        if (inEvent) block.forEach { out.append(it).append("\r\n") }
        return Result(out.toString(), kept, dropped)
    }

    private fun keep(block: List<String>, cutoff: String): Boolean {
        var dtstart: String? = null
        var dtend: String? = null
        var rrule: String? = null
        var hasRdate = false
        for (line in block) {
            val colon = valueSeparator(line)
            if (colon < 0) continue
            val name = line.substring(0, colon).substringBefore(';').uppercase()
            val value = line.substring(colon + 1)
            when (name) {
                "DTSTART" -> if (dtstart == null) dtstart = value
                "DTEND" -> if (dtend == null) dtend = value
                "RRULE" -> if (rrule == null) rrule = value
                "RDATE" -> hasRdate = true
            }
        }
        if (rrule != null) {
            val until = UNTIL.find(rrule)?.groupValues?.get(1) ?: return true
            return until >= cutoff
        }
        if (hasRdate) return true
        val end = (dtend ?: dtstart)?.let { DATE8.find(it)?.groupValues?.get(1) } ?: return true
        return end >= cutoff
    }

    /** Index of the ':' separating name/params from value (params may contain quoted ':'). */
    private fun valueSeparator(line: String): Int {
        var quoted = false
        for (i in line.indices) {
            when (line[i]) {
                '"' -> quoted = !quoted
                ':' -> if (!quoted) return i
            }
        }
        return -1
    }

    /** RFC 5545 line unfolding: a line starting with space or tab continues the previous one. */
    fun unfold(ics: String): List<String> {
        val out = ArrayList<String>()
        for (raw in ics.split("\r\n", "\n", "\r")) {
            if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.isNotEmpty()) {
                out[out.size - 1] = out[out.size - 1] + raw.substring(1)
            } else {
                out += raw
            }
        }
        return out
    }
}
