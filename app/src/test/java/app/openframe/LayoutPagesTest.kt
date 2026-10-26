package app.openframe

import org.json.JSONArray
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class LayoutPagesTest {

    // Hybrid as a custom page (what "Customize" makes), landscape and portrait.
    private val land = """{"cols":12,"rows":24,"widgets":[
        {"id":"photo","type":"photo","x":0,"y":0,"w":9,"h":24},
        {"id":"clock","type":"clock_weather","style":"panel","x":9,"y":0,"w":3,"h":5},
        {"id":"calendar","type":"calendar_day","x":9,"y":5,"w":3,"h":19,"days":1},
        {"id":"caption","type":"caption","anchor":{"corner":"bottom-left","over":"photo"}},
        {"id":"status","type":"status","anchor":{"corner":"bottom-left","over":"photo"}}]}"""
    private val port = """{"cols":12,"rows":24,"widgets":[
        {"id":"photo","type":"photo","x":0,"y":0,"w":12,"h":18},
        {"id":"clock","type":"clock_weather","style":"overlay","anchor":{"corner":"top-right","over":"photo"}},
        {"id":"calendar","type":"calendar_day","x":0,"y":18,"w":12,"h":6,"days":2}]}"""

    private fun page(id: String = "home", l: String = land, p: String = port) =
        """{"id":"$id","name":"Family","landscape":$l,"portrait":$p}"""

    private fun check(pages: String, home: String = "") = LayoutPages.validate(JSONArray(pages), home)

    private fun rejects(pages: String, home: String = "", message: String) {
        val e = assertThrows(IllegalArgumentException::class.java) { check(pages, home) }
        assertTrue("expected \"$message\" in \"${e.message}\"", e.message!!.contains(message))
    }

    /** The landscape arrangement with its widget list replaced. */
    private fun landWith(widgets: String) = """{"cols":12,"rows":24,"widgets":[$widgets]}"""

    @Test fun emptyAndBuiltInPagesAreValid() {
        check("[]")
        check("""[{"id":"home","name":"Hybrid","preset":"hybrid"},{"id":"cal","name":"Calendar","preset":"calendar"}]""", "cal")
    }

    @Test fun customPagesAreValid() {
        check("[${page()},${page("kitchen")}]", "kitchen")
    }

    @Test fun pagesNeedUniqueIdsAndNames() {
        rejects("[${page()},${page()}]", message = "used twice")
        rejects("""[{"id":"Home!","name":"x","preset":"hybrid"}]""", message = "bad id")
        rejects("""[{"id":"home","name":" ","preset":"hybrid"}]""", message = "name")
        rejects("""[{"id":"home","name":"x","preset":"hybrid"}]""", "other", message = "no page other")
    }

    @Test fun atMostEightPages() {
        check((1..8).joinToString(",", "[", "]") { """{"id":"p$it","name":"P$it","preset":"pictures"}""" })
        rejects((1..9).joinToString(",", "[", "]") { """{"id":"p$it","name":"P$it","preset":"pictures"}""" }, message = "At most 8")
    }

    @Test fun builtInPagesHaveNoArrangements() {
        rejects("""[{"id":"home","name":"x","preset":"hybrid","landscape":$land}]""", message = "built-in")
        rejects("""[{"id":"home","name":"x","preset":"collage"}]""", message = "unknown preset")
    }

    @Test fun customPagesNeedBothOrientationsOnTheGrid() {
        rejects("""[{"id":"home","name":"x","landscape":$land}]""", message = "portrait")
        rejects("[${page(l = land.replace("\"rows\":24", "\"rows\":12"))}]", message = "12×24")
    }

    @Test fun widgetsStayInsideAndDoNotOverlap() {
        rejects("[${page(l = landWith("""{"id":"photo","type":"photo","x":4,"y":0,"w":9,"h":24}"""))}]", message = "outside")
        rejects("[${page(l = landWith("""{"id":"photo","type":"photo","x":0,"y":0,"w":9,"h":24},
            {"id":"cal","type":"calendar_day","x":8,"y":0,"w":4,"h":24}"""))}]", message = "cal overlaps photo")
        rejects("[${page(l = landWith("""{"id":"photo","type":"photo","x":0,"y":0,"w":9.5,"h":24}"""))}]", message = "whole-number")
    }

    @Test fun widgetsArePlacedTheWayTheyCanBeShown() {
        rejects("[${page(l = landWith("""{"id":"caption","type":"caption","x":0,"y":0,"w":2,"h":2}"""))}]", message = "corner")
        rejects("[${page(l = landWith("""{"id":"photo","type":"photo","anchor":{"corner":"top-left"}}"""))}]", message = "box on the grid")
        rejects("[${page(l = landWith("""{"id":"c","type":"clock_weather","style":"panel","anchor":{"corner":"top-left"}}"""))}]", message = "overlay")
        rejects("[${page(l = landWith("""{"id":"c","type":"clock_weather","x":0,"y":0,"w":2,"h":2}"""))}]", message = "panel")
        rejects("[${page(l = landWith("""{"id":"s","type":"status","anchor":{"corner":"middle"}}"""))}]", message = "corner")
        rejects("[${page(l = landWith("""{"id":"s","type":"status","anchor":{"corner":"top-left","over":"photo"}}"""))}]", message = "isn't on the page")
        rejects("[${page(l = landWith("""{"id":"x","type":"ha_dashboard","x":0,"y":0,"w":2,"h":2}"""))}]", message = "unknown type")
        rejects("[${page(l = landWith("""{"id":"d","type":"calendar_day","x":0,"y":0,"w":2,"h":2,"days":6}"""))}]", message = "days")
    }

    @Test fun onePhotoPerPage() {
        rejects("[${page(l = landWith("""{"id":"a","type":"photo","x":0,"y":0,"w":6,"h":24},
            {"id":"b","type":"photo","x":6,"y":0,"w":6,"h":24}"""))}]", message = "only one photo")
        // Several day panels or clocks are fine.
        check("[${page(l = landWith("""{"id":"a","type":"calendar_day","x":0,"y":0,"w":6,"h":24},
            {"id":"b","type":"calendar_day","x":6,"y":0,"w":6,"h":24}"""))}]")
    }
}
