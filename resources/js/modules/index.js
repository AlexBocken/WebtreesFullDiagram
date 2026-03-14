/**
 * Full Diagram — entry point.
 *
 * Reads embedded data from the page and initializes the chart.
 */
import Chart from "./lib/chart.js";

// Expose Chart class for block usage
window.FullDiagramChart = Chart;

async function init() {
    const data = window.fullDiagramData;
    const baseUrl = window.fullDiagramBaseUrl;

    if (!data || !data.persons) {
        console.error("Full Diagram: No tree data found.");
        return;
    }

    try {
        const chart = new Chart("#full-diagram-container", data, baseUrl);
        await chart.render();
    } catch (err) {
        console.error("Full Diagram: Render failed", err);
    }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
