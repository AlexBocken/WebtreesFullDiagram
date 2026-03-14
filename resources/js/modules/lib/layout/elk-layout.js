/**
 * ELK (Eclipse Layout Kernel) based family tree layout.
 *
 * Uses the union-node pattern with ELK's Sugiyama algorithm for
 * guaranteed overlap-free positioning. Connector lines are drawn
 * manually using clean orthogonal bus lines (not ELK's edge routing).
 *
 * ELK handles all node placement — no post-processing adjustments.
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

    // ── Step 1: Read raw ELK positions (centered on root) ──
    const posMap = new Map(); // id → { x, y }
    let rootX = 0,
        rootY = 0;

    for (const elkNode of elkResult.children || []) {
        const nodeInfo = builder.nodes.get(elkNode.id);
        if (!nodeInfo) continue;
        const cx = elkNode.x + elkNode.width / 2;
        const cy = elkNode.y + elkNode.height / 2;
        if (nodeInfo.isMain) {
            rootX = cx;
            rootY = cy;
        }
        posMap.set(elkNode.id, { cx, cy });
    }

    // ── Step 2: Snap person Y to generation rows (keep ELK X untouched) ──
    // Group persons by generation, compute median Y per generation
    const genGroups = new Map(); // generation → [id, ...]
    for (const [id, pos] of posMap) {
        const nodeInfo = builder.nodes.get(id);
        if (!nodeInfo || nodeInfo.type !== "person") continue;
        const gen = builder.generations.get(id) ?? 0;
        if (!genGroups.has(gen)) genGroups.set(gen, []);
        genGroups.get(gen).push(id);
    }

    const genY = new Map(); // generation → canonical Y
    for (const [gen, ids] of genGroups) {
        const ys = ids.map((id) => posMap.get(id).cy).sort((a, b) => a - b);
        const mid = Math.floor(ys.length / 2);
        genY.set(
            gen,
            ys.length % 2 === 0 ? (ys[mid - 1] + ys[mid]) / 2 : ys[mid]
        );
    }

    // Apply: center on root, snap person Y to generation row
    const mainGen = builder.generations.get(builder.mainId) ?? 0;
    const snappedRootY = genY.get(mainGen) ?? rootY;

    for (const [id, pos] of posMap) {
        const nodeInfo = builder.nodes.get(id);
        pos.x = pos.cx - rootX;
        if (nodeInfo && nodeInfo.type === "person") {
            const gen = builder.generations.get(id) ?? 0;
            pos.y = (genY.get(gen) ?? pos.cy) - snappedRootY;
        } else {
            pos.y = pos.cy - snappedRootY;
        }
    }

    // ── Step 3: Build edge maps ──
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

    // ── Step 4: Snap union Y to grid between generation rows ──
    // Compute a consistent couple-bar Y and child-bus Y for each
    // pair of adjacent generations, so all connectors align on a grid.
    const sortedGens = [...genY.keys()].sort((a, b) => a - b);

    // coupleBarY: between parent gen and child gen (40% down from parent bottom)
    // childBusY: between parent gen and child gen (70% down from parent bottom)
    const coupleBarY = new Map(); // "parentGen|childGen" → Y
    const childBusY = new Map();

    for (let i = 0; i < sortedGens.length - 1; i++) {
        const upperGen = sortedGens[i];
        const lowerGen = sortedGens[i + 1];
        const upperY = (genY.get(upperGen) ?? 0) - snappedRootY;
        const lowerY = (genY.get(lowerGen) ?? 0) - snappedRootY;
        const parentBottom = upperY + halfH;
        const childTop = lowerY - halfH;
        const gap = childTop - parentBottom;
        const key = `${upperGen}|${lowerGen}`;
        coupleBarY.set(key, parentBottom + gap * 0.35);
        childBusY.set(key, parentBottom + gap * 0.65);
    }

    // Snap each union node Y to the couple-bar grid line
    for (const [unionId, node] of builder.nodes) {
        if (node.type !== "union") continue;
        const parentIds = incomingToUnion.get(unionId) || [];
        const childIds = outgoingFromUnion.get(unionId) || [];
        if (parentIds.length === 0 || childIds.length === 0) continue;

        const parentGen = builder.generations.get(parentIds[0]);
        const childGen = builder.generations.get(childIds[0]);
        if (parentGen === undefined || childGen === undefined) continue;

        const key = `${parentGen}|${childGen}`;
        const barY = coupleBarY.get(key);
        if (barY !== undefined) {
            const pos = posMap.get(unionId);
            if (pos) pos.y = barY;
        }
    }

    // ── Step 5: Collect final positioned nodes ──
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

    // ── Step 6: Build grid-aligned bus-line connectors ──

    // Pre-compute offsets for parents in multiple unions (multiple spouses).
    // Each union a parent belongs to gets an offset so the vertical drop
    // lines fan out from the card instead of overlapping at center.
    const parentToUnions = new Map(); // personId → [unionId, ...]
    for (const union of unions) {
        for (const pid of incomingToUnion.get(union.id) || []) {
            if (!parentToUnions.has(pid)) parentToUnions.set(pid, []);
            parentToUnions.get(pid).push(union.id);
        }
    }

    // Sort each parent's unions by their union X so offsets are spatially consistent
    const dropOffset = new Map(); // "personId|unionId" → offset pixels
    const offsetStep = 14;
    for (const [pid, uids] of parentToUnions) {
        if (uids.length <= 1) continue;
        uids.sort((a, b) => {
            const ua = unions.find((u) => u.id === a);
            const ub = unions.find((u) => u.id === b);
            return (ua?.x ?? 0) - (ub?.x ?? 0);
        });
        for (let i = 0; i < uids.length; i++) {
            const off = (i - (uids.length - 1) / 2) * offsetStep;
            dropOffset.set(`${pid}|${uids[i]}`, off);
        }
    }

    for (const union of unions) {
        const parentIds = incomingToUnion.get(union.id) || [];
        const childIds = outgoingFromUnion.get(union.id) || [];

        const children = childIds
            .map((id) => posMap.get(id))
            .filter(Boolean);

        const ux = union.x;
        const uy = union.y;

        // ── Parent → union connections ──
        if (parentIds.length > 0) {
            // Compute the drop X for each parent (offset if multi-spouse)
            const dropXs = parentIds.map((pid) => {
                const pos = posMap.get(pid);
                if (!pos) return null;
                const off = dropOffset.get(`${pid}|${union.id}`) ?? 0;
                return { pid, x: pos.x + off, y: pos.y };
            }).filter(Boolean);

            // Horizontal couple bar between the drop points
            if (dropXs.length >= 2) {
                const xs = dropXs.map((d) => d.x).sort((a, b) => a - b);
                connections.push({
                    path: `M ${xs[0]} ${uy} L ${xs[xs.length - 1]} ${uy}`,
                    cssClass: "link couple-link",
                });
            }

            // Vertical drop from each parent's bottom edge to couple bar
            for (const d of dropXs) {
                const bottomY = d.y + halfH;
                connections.push({
                    path: `M ${d.x} ${bottomY} L ${d.x} ${uy}`,
                    cssClass: "link ancestor-link",
                });
            }
        }

        // ── Union → children connections ──
        if (children.length > 0) {
            // Use grid-aligned bus Y for this generation pair
            const parentGen = parentIds.length > 0
                ? builder.generations.get(parentIds[0])
                : undefined;
            const childGen = childIds.length > 0
                ? builder.generations.get(childIds[0])
                : undefined;
            const busKey =
                parentGen !== undefined && childGen !== undefined
                    ? `${parentGen}|${childGen}`
                    : null;
            const busY = (busKey && childBusY.get(busKey)) ?? uy + (children[0].y - halfH - uy) / 2;

            // Vertical stem from union down to child bus (ELK X)
            connections.push({
                path: `M ${ux} ${uy} L ${ux} ${busY}`,
                cssClass: "link descendant-link",
            });

            if (children.length === 1) {
                connections.push({
                    path: `M ${children[0].x} ${busY} L ${children[0].x} ${children[0].y - halfH}`,
                    cssClass: "link descendant-link",
                });
            } else {
                const xs = children
                    .map((c) => c.x)
                    .sort((a, b) => a - b);
                connections.push({
                    path: `M ${xs[0]} ${busY} L ${xs[xs.length - 1]} ${busY}`,
                    cssClass: "link descendant-link",
                });

                for (const c of children) {
                    connections.push({
                        path: `M ${c.x} ${busY} L ${c.x} ${c.y - halfH}`,
                        cssClass: "link descendant-link",
                    });
                }
            }
        }
    }

    return { persons, unions, connections };
}
