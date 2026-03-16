/**
 * Main chart orchestrator.
 *
 * Uses ELK for layout (Sugiyama / union-node pattern) and D3 for
 * SVG rendering with clean orthogonal bus-line connectors.
 */
import { computeElkLayout } from "./layout/elk-layout.js";
import { createSvg, getCanvas } from "./chart/svg.js";
import { initZoom, createZoomControls } from "./chart/zoom.js";
import { renderPersonCard } from "./chart/box.js";
import { hideTooltip } from "./chart/overlay.js";
import { zoomIdentity } from "./d3.js";

export default class Chart {
    constructor(containerSelector, data, baseUrl) {
        this.containerSelector = containerSelector;
        this.data = data;
        this.config = {
            cardWidth: 200,
            cardHeight: 80,
            horizontalSpacing: 30,
            verticalSpacing: 60,
        };
        this.baseUrl = baseUrl;
    }

    async render() {
        const ctr = this.containerSelector;
        const chartSelector = `${ctr} .full-diagram-chart`;

        const svg = createSvg(chartSelector);
        this.svg = svg;

        const zoomBehavior = initZoom(svg);
        this.zoomBehavior = zoomBehavior;

        svg.on("zoom.tooltip", () => hideTooltip());
        createZoomControls(ctr, svg, zoomBehavior);

        const canvas = getCanvas(svg);

        // Compute layout using ELK
        const layout = await computeElkLayout(
            this.data.persons,
            this.data.mainId,
            this.config
        );

        // Click handler
        const baseUrl = this.baseUrl;
        const onNodeClick = (data) => {
            hideTooltip();
            const url = baseUrl.replace("__XREF__", data.id);
            window.location.href = url;
        };

        // Draw connections first (behind cards)
        this.renderConnections(canvas, layout);

        // Draw person cards
        for (const person of layout.persons) {
            renderPersonCard(canvas, person, this.config, onNodeClick, ctr);
        }

        // Center on root
        this.centerOnRoot();
    }

    renderConnections(canvas, layout) {
        const linkGroup = canvas.append("g").attr("class", "edges");

        for (const conn of layout.connections) {
            linkGroup
                .append("path")
                .attr("class", conn.cssClass)
                .attr("d", conn.path);
        }
    }

    centerOnRoot() {
        const { width, height } = this.svg.node().getBoundingClientRect();
        this.svg.call(
            this.zoomBehavior.transform,
            zoomIdentity.translate(width / 2, height / 2)
        );
    }
}
