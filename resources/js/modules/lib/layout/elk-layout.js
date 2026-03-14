/**
 * ELK (Eclipse Layout Kernel) based family tree layout.
 *
 * Uses the union-node pattern with ELK's Sugiyama algorithm for
 * guaranteed overlap-free positioning. Connector lines are drawn
 * manually using clean orthogonal bus lines (not ELK's edge routing).
 *
 * Post-processing snaps all people of the same generation to the same
 * Y coordinate and repositions union nodes between generation rows.
 * Spouse-grouped node ordering keeps couples placed close together.
 *
 * Input: flat person array with rels { parents, spouses, children }
 * Output: positioned persons + orthogonal connector paths
 */
import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

/**
 * @param {Array} persons - Flat array of { id, data, rels }
 * @param {string} mainId - Root person ID
 * @param {object} config - Card dimensions and spacing
 * @returns {Promise<LayoutResult>}
 */
export async function computeElkLayout(persons, mainId, config) {
    const builder = new GraphBuilder(persons, mainId, config);
    builder.build();
    const graph = builder.buildElkGraph();
    const result = await elk.layout(graph);
    return extractPositions(result, builder, config);
}

// ─── Graph Builder ───────────────────────────────────────────────────

class GraphBuilder {
    constructor(persons, mainId, config) {
        this.config = config;
        this.personById = new Map();
        for (const p of persons) {
            this.personById.set(p.id, p);
        }
        this.mainId = mainId;

        this.nodes = new Map(); // id → { id, type, data }
        this.edges = [];
        this.unionCounter = 0;

        // Track which family units we've already created union nodes for
        // key = sorted parent IDs joined, value = union node id
        this.familyUnions = new Map();

        // Generation number per person (0 = main, negative = ancestors, positive = descendants)
        this.generations = new Map();
    }

    build() {
        // Add all persons as nodes
        for (const [id, person] of this.personById) {
            this.nodes.set(id, {
                id: id,
                type: "person",
                data: person.data,
                isMain: id === this.mainId,
            });
        }

        // For each person, create union nodes for their family relationships
        for (const [id, person] of this.personById) {
            const parents = (person.rels.parents || []).filter((pid) =>
                this.personById.has(pid)
            );

            if (parents.length > 0) {
                const unionId = this.getOrCreateFamilyUnion(parents);
                // union → child
                this.addEdge(unionId, id);
            }
        }

        // Compute generation numbers via BFS from main person
        this.computeGenerations();
    }

    /**
     * BFS from the main person to assign generation numbers.
     * Spouses get the same generation, parents get gen-1, children get gen+1.
     * Spouses are processed first to ensure they share a layer.
     */
    computeGenerations() {
        this.generations.set(this.mainId, 0);
        const queue = [this.mainId];
        const visited = new Set([this.mainId]);

        while (queue.length > 0) {
            const id = queue.shift();
            const gen = this.generations.get(id);
            const person = this.personById.get(id);
            if (!person) continue;

            // Spouses = same generation (process first for consistency)
            for (const sid of person.rels.spouses || []) {
                if (!visited.has(sid) && this.personById.has(sid)) {
                    this.generations.set(sid, gen);
                    visited.add(sid);
                    queue.push(sid);
                }
            }

            // Parents = one generation up
            for (const pid of person.rels.parents || []) {
                if (!visited.has(pid) && this.personById.has(pid)) {
                    this.generations.set(pid, gen - 1);
                    visited.add(pid);
                    queue.push(pid);
                }
            }

            // Children = one generation down
            for (const cid of person.rels.children || []) {
                if (!visited.has(cid) && this.personById.has(cid)) {
                    this.generations.set(cid, gen + 1);
                    visited.add(cid);
                    queue.push(cid);
                }
            }
        }
    }

    /**
     * Get or create a union node for a set of parents.
     * Creates parent → union edges on first creation.
     */
    getOrCreateFamilyUnion(parentIds) {
        const key = [...parentIds].sort().join("|");
        if (this.familyUnions.has(key)) {
            return this.familyUnions.get(key);
        }

        const unionId = `union_${this.unionCounter++}`;
        this.nodes.set(unionId, {
            id: unionId,
            type: "union",
            data: null,
        });
        this.familyUnions.set(key, unionId);

        // parent → union edges (high priority to keep parents close)
        for (const pid of parentIds) {
            this.addEdge(pid, unionId, 10);
        }

        return unionId;
    }

    addEdge(source, target, priority = 1) {
        const exists = this.edges.some(
            (e) => e.source === source && e.target === target
        );
        if (!exists) {
            this.edges.push({ source, target, priority });
        }
    }

    buildElkGraph() {
        const w = this.config.cardWidth;
        const h = this.config.cardHeight;
        const unionSize = 2;

        // Order person nodes with spouses adjacent for model-order awareness
        const orderedPersonIds = this._orderPersonsBySpouseGroups();

        const elkNodes = [];

        // Add person nodes in spouse-grouped order
        for (const id of orderedPersonIds) {
            elkNodes.push({
                id: id,
                width: w,
                height: h,
            });
        }

        // Add union nodes
        for (const [id, node] of this.nodes) {
            if (node.type !== "union") continue;
            elkNodes.push({
                id: id,
                width: unionSize,
                height: unionSize,
            });
        }

        const elkEdges = this.edges.map((e, i) => {
            const edge = {
                id: `e${i}`,
                sources: [e.source],
                targets: [e.target],
            };
            if (e.priority > 1) {
                edge.layoutOptions = {
                    "elk.layered.priority.direction": String(e.priority),
                    "elk.layered.priority.shortness": String(e.priority),
                };
            }
            return edge;
        });

        return {
            id: "root",
            layoutOptions: {
                "elk.algorithm": "layered",
                "elk.direction": "DOWN",
                "elk.edgeRouting": "ORTHOGONAL",
                "elk.layered.spacing.nodeNodeBetweenLayers": String(
                    this.config.verticalSpacing
                ),
                "elk.spacing.nodeNode": String(this.config.horizontalSpacing),
                "elk.layered.spacing.edgeNodeBetweenLayers": "15",
                "elk.layered.spacing.edgeEdgeBetweenLayers": "10",
                "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
                "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
                "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
                "elk.separateConnectedComponents": "false",
                "elk.layered.compaction.postCompaction.strategy":
                    "EDGE_LENGTH",
            },
            children: elkNodes,
            edges: elkEdges,
        };
    }

    /**
     * Order person nodes so that spouse pairs are adjacent in the input.
     * Combined with considerModelOrder, this keeps couples placed close together.
     */
    _orderPersonsBySpouseGroups() {
        const ordered = [];
        const added = new Set();

        for (const [id, person] of this.personById) {
            if (added.has(id)) continue;
            added.add(id);
            ordered.push(id);

            // Add spouses immediately after this person
            const spouses = (person.rels.spouses || []).filter(
                (sid) => this.personById.has(sid) && !added.has(sid)
            );
            for (const sid of spouses) {
                added.add(sid);
                ordered.push(sid);
            }
        }

        return ordered;
    }
}

// ─── Extract positions & build clean connectors ──────────────────────

function extractPositions(elkResult, builder, config) {
    const persons = [];
    const unions = [];
    const connections = [];

    const halfH = config.cardHeight / 2;

    // ── Step 1: Read raw ELK positions ──
    const rawPos = new Map(); // id → { cx, cy }
    let rootX = 0,
        rootY = 0;

    for (const elkNode of elkResult.children || []) {
        const nodeInfo = builder.nodes.get(elkNode.id);
        if (!nodeInfo) continue;
        const cx = elkNode.x + elkNode.width / 2;
        const cy = elkNode.y + elkNode.height / 2;
        rawPos.set(elkNode.id, { cx, cy });
        if (nodeInfo.isMain) {
            rootX = cx;
            rootY = cy;
        }
    }

    // ── Step 2: Snap person nodes to generation rows ──
    // Group person nodes by generation, compute median Y for each generation
    const genGroups = new Map(); // generation → [{ id, cx, cy }]
    for (const [id, pos] of rawPos) {
        const nodeInfo = builder.nodes.get(id);
        if (!nodeInfo || nodeInfo.type !== "person") continue;
        const gen = builder.generations.get(id) || 0;
        if (!genGroups.has(gen)) genGroups.set(gen, []);
        genGroups.get(gen).push({ id, ...pos });
    }

    // For each generation, use the median Y as the canonical row Y
    const genY = new Map(); // generation → snapped Y
    for (const [gen, nodes] of genGroups) {
        const ys = nodes.map((n) => n.cy).sort((a, b) => a - b);
        const mid = Math.floor(ys.length / 2);
        const medianY =
            ys.length % 2 === 0 ? (ys[mid - 1] + ys[mid]) / 2 : ys[mid];
        genY.set(gen, medianY);
    }

    // ── Step 3: Compute union node Y positions ──
    // Each union sits between its parent generation row and child generation row
    const unionGenY = new Map(); // unionId → snapped Y
    for (const [id, node] of builder.nodes) {
        if (node.type !== "union") continue;

        // Find parent generation (edges INTO this union)
        let parentGen = null;
        let childGen = null;
        for (const edge of builder.edges) {
            if (edge.target === id && builder.generations.has(edge.source)) {
                parentGen = builder.generations.get(edge.source);
            }
            if (edge.source === id && builder.generations.has(edge.target)) {
                childGen = builder.generations.get(edge.target);
            }
        }

        if (parentGen !== null && childGen !== null) {
            const pY = genY.get(parentGen);
            const cY = genY.get(childGen);
            if (pY !== undefined && cY !== undefined) {
                // Place union at: parent bottom edge + 40% of gap to child top edge
                const parentBottom = pY + halfH;
                const childTop = cY - halfH;
                unionGenY.set(id, parentBottom + (childTop - parentBottom) * 0.4);
                continue;
            }
        }

        // Fallback: use raw ELK position
        const raw = rawPos.get(id);
        if (raw) unionGenY.set(id, raw.cy);
    }

    // ── Step 4: Build initial positions (centered on root) ──
    const posMap = new Map(); // id → { x, y }

    // Recalculate rootY using the snapped generation Y
    const mainGen = builder.generations.get(builder.mainId) || 0;
    const snappedRootY = genY.get(mainGen) || rootY;

    for (const [id, node] of builder.nodes) {
        const raw = rawPos.get(id);
        if (!raw) continue;

        let finalY;
        if (node.type === "person") {
            const gen = builder.generations.get(id) || 0;
            finalY = (genY.get(gen) || raw.cy) - snappedRootY;
        } else {
            finalY = (unionGenY.get(id) || raw.cy) - snappedRootY;
        }

        const finalX = raw.cx - rootX;
        posMap.set(id, { x: finalX, y: finalY });
    }

    // ── Step 4b: Resolve overlaps per generation row ──
    // After Y-snapping, nodes from different ELK layers may now share a row.
    // For each generation, sort by X and push overlapping nodes apart.
    const minGap = config.cardWidth + config.horizontalSpacing;

    for (const [gen, nodes] of genGroups) {
        // Get current X positions for this generation's person nodes
        const rowNodes = nodes
            .map((n) => ({ id: n.id, x: posMap.get(n.id)?.x ?? 0 }))
            .sort((a, b) => a.x - b.x);

        // Sweep left to right, push overlapping nodes to the right
        for (let i = 1; i < rowNodes.length; i++) {
            const prev = rowNodes[i - 1];
            const curr = rowNodes[i];
            const overlap = prev.x + minGap - curr.x;
            if (overlap > 0) {
                curr.x = prev.x + minGap;
                const pos = posMap.get(curr.id);
                if (pos) pos.x = curr.x;
            }
        }

        // Re-center the row so shifts don't drift the whole diagram
        // Calculate how much the row center shifted and compensate
        const origXs = nodes
            .map((n) => rawPos.get(n.id)?.cx ?? 0)
            .sort((a, b) => a - b);
        const newXs = rowNodes.map((n) => n.x).sort((a, b) => a - b);
        const origCenter = (origXs[0] + origXs[origXs.length - 1]) / 2 - rootX;
        const newCenter = (newXs[0] + newXs[newXs.length - 1]) / 2;
        const drift = newCenter - origCenter;

        if (Math.abs(drift) > 1) {
            for (const rn of rowNodes) {
                rn.x -= drift;
                const pos = posMap.get(rn.id);
                if (pos) pos.x = rn.x;
            }
        }
    }

    // ── Step 4c: Collect final positioned nodes ──
    for (const [id, node] of builder.nodes) {
        const pos = posMap.get(id);
        if (!pos) continue;

        if (node.type === "person") {
            persons.push({
                x: pos.x,
                y: pos.y,
                id: node.id,
                isMain: node.isMain,
                data: node.data,
            });
        } else {
            unions.push({ id: id, x: pos.x, y: pos.y });
        }
    }

    // ── Step 5: Build clean bus-line connectors ──
    const incomingToUnion = new Map();
    const outgoingFromUnion = new Map();

    for (const edge of builder.edges) {
        const sourceInfo = builder.nodes.get(edge.source);
        const targetInfo = builder.nodes.get(edge.target);

        if (targetInfo && targetInfo.type === "union") {
            if (!incomingToUnion.has(edge.target))
                incomingToUnion.set(edge.target, []);
            incomingToUnion.get(edge.target).push(edge.source);
        }

        if (sourceInfo && sourceInfo.type === "union") {
            if (!outgoingFromUnion.has(edge.source))
                outgoingFromUnion.set(edge.source, []);
            outgoingFromUnion.get(edge.source).push(edge.target);
        }
    }

    for (const union of unions) {
        const parentIds = incomingToUnion.get(union.id) || [];
        const childIds = outgoingFromUnion.get(union.id) || [];

        const parents = parentIds
            .map((id) => posMap.get(id))
            .filter(Boolean);
        const children = childIds
            .map((id) => posMap.get(id))
            .filter(Boolean);

        const ux = union.x;
        const uy = union.y;

        // ── Parent → union connections ──
        if (parents.length > 0) {
            // Horizontal couple bar at union Y
            if (parents.length >= 2) {
                const xs = parents.map((p) => p.x).sort((a, b) => a - b);
                connections.push({
                    path: `M ${xs[0]} ${uy} L ${xs[xs.length - 1]} ${uy}`,
                    cssClass: "link couple-link",
                });
            }

            // Vertical drop from each parent's bottom edge to couple bar Y
            for (const p of parents) {
                const bottomY = p.y + halfH;
                connections.push({
                    path: `M ${p.x} ${bottomY} L ${p.x} ${uy}`,
                    cssClass: "link ancestor-link",
                });
            }
        }

        // ── Union → children connections ──
        if (children.length > 0) {
            // Bus Y halfway between union and children's top edge
            const childY = children[0].y;
            const busY = uy + (childY - halfH - uy) / 2;

            // Vertical stem from union down to bus
            connections.push({
                path: `M ${ux} ${uy} L ${ux} ${busY}`,
                cssClass: "link descendant-link",
            });

            if (children.length === 1) {
                // Single child: continue vertical line
                connections.push({
                    path: `M ${children[0].x} ${busY} L ${children[0].x} ${childY - halfH}`,
                    cssClass: "link descendant-link",
                });
            } else {
                // Horizontal bus spanning all children
                const xs = children
                    .map((c) => c.x)
                    .sort((a, b) => a - b);
                connections.push({
                    path: `M ${xs[0]} ${busY} L ${xs[xs.length - 1]} ${busY}`,
                    cssClass: "link descendant-link",
                });

                // Vertical drops from bus to each child's top edge
                for (const c of children) {
                    connections.push({
                        path: `M ${c.x} ${busY} L ${c.x} ${childY - halfH}`,
                        cssClass: "link descendant-link",
                    });
                }
            }
        }
    }

    return { persons, unions, connections };
}
