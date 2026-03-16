/**
 * Pan and zoom behavior via d3-zoom.
 */
import { zoom, zoomIdentity, select } from "../d3.js";
import { getCanvas } from "./svg.js";

// Inline Lucide SVG icons (24x24 viewBox, stroke-based)
const ICON_MAXIMIZE = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
const ICON_X = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/**
 * Initialize zoom behavior on the SVG element.
 *
 * @param {d3.Selection} svg
 * @returns {d3.ZoomBehavior}
 */
export function initZoom(svg) {
    const canvas = getCanvas(svg);

    const zoomBehavior = zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
            canvas.attr("transform", event.transform);
        });

    svg.call(zoomBehavior);

    // Disable double-click zoom (we use click for navigation)
    svg.on("dblclick.zoom", null);

    return zoomBehavior;
}

/**
 * Create zoom control buttons.
 *
 * @param {string} containerSelector
 * @param {d3.Selection} svg
 * @param {d3.ZoomBehavior} zoomBehavior
 */
export function createZoomControls(containerSelector, svg, zoomBehavior) {
    const container = select(containerSelector);

    const controls = container
        .append("div")
        .attr("class", "zoom-controls");

    controls
        .append("button")
        .attr("type", "button")
        .attr("title", "Zoom in")
        .text("+")
        .on("click", () => svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.3));

    controls
        .append("button")
        .attr("type", "button")
        .attr("title", "Zoom out")
        .text("\u2212")
        .on("click", () => svg.transition().duration(300).call(zoomBehavior.scaleBy, 0.7));

    controls
        .append("button")
        .attr("type", "button")
        .attr("title", "Reset view")
        .text("\u21BA")
        .on("click", () => {
            const { width, height } = svg.node().getBoundingClientRect();
            svg.transition()
                .duration(500)
                .call(
                    zoomBehavior.transform,
                    zoomIdentity.translate(width / 2, height / 2)
                );
        });

    // Fullscreen toggle
    const fullscreenBtn = controls
        .append("button")
        .attr("type", "button")
        .attr("title", "Toggle fullscreen")
        .attr("class", "fullscreen-btn")
        .html(ICON_MAXIMIZE)
        .on("click", () => {
            const el = container.node();
            if (!document.fullscreenElement) {
                (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen).call(el);
            } else {
                (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen).call(document);
            }
        });

    function updateFullscreenIcon() {
        fullscreenBtn.html(document.fullscreenElement ? ICON_X : ICON_MAXIMIZE);
        fullscreenBtn.attr("title", document.fullscreenElement ? "Exit fullscreen" : "Toggle fullscreen");
    }

    document.addEventListener("fullscreenchange", updateFullscreenIcon);
    document.addEventListener("webkitfullscreenchange", updateFullscreenIcon);
}
