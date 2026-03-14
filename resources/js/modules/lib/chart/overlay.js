/**
 * Bio card tooltip on hover.
 *
 * Shows: full name, profile photo, birth, baptism, marriage, death,
 * occupation, residence, current age (if alive) or age at death.
 *
 * Uses window.fullDiagramI18n for translated labels.
 */
import { select } from "../d3.js";

let activeTooltip = null;
let hideTimer = null;

/** Get a translated string, with optional substitution. */
function t(key, ...args) {
    const i18n = window.fullDiagramI18n || {};
    let str = i18n[key] || key;
    for (const arg of args) {
        str = str.replace("__AGE__", arg);
    }
    return str;
}

/**
 * Show a bio card tooltip for a person.
 *
 * @param {object} data - Person data
 * @param {SVGElement} cardElement - The SVG card group element
 * @param {string} containerSelector
 */
export function showBioCard(data, cardElement, containerSelector) {
    hideTooltip();

    const container = select(containerSelector);
    const containerRect = container.node().getBoundingClientRect();
    const cardRect = cardElement.getBoundingClientRect();

    // Position tooltip below the card, centered
    const left = cardRect.left - containerRect.left + cardRect.width / 2;
    const top = cardRect.bottom - containerRect.top + 8;

    const tooltip = container
        .append("div")
        .attr("class", "bio-card")
        .style("left", `${left}px`)
        .style("top", `${top}px`)
        .style("transform", "translateX(-50%)")
        .on("mouseenter", () => clearTimeout(hideTimer))
        .on("mouseleave", () => scheduleHide());

    // Header: photo + name
    const header = tooltip.append("div").attr("class", "bio-header");

    if (data.avatar) {
        header
            .append("img")
            .attr("src", data.avatar)
            .attr("alt", data.fullName || "")
            .attr("class", "bio-photo");
    }

    const headerText = header.append("div").attr("class", "bio-header-text");
    headerText.append("div").attr("class", "bio-name").text(data.fullName || "???");

    // Age
    const ageText = computeAge(data);
    if (ageText) {
        headerText.append("div").attr("class", "bio-age").text(ageText);
    }

    // Facts list
    const facts = tooltip.append("div").attr("class", "bio-facts");

    addFact(facts, t("Born"), data.birthDate, data.birthPlace);
    addFact(facts, t("Baptism"), data.baptismDate);
    addFact(facts, t("Marriage"), data.marriageDate);
    addFact(facts, t("Died"), data.deathDate, data.deathPlace);
    addFact(facts, t("Occupation"), data.occupation);
    addFact(facts, t("Residence"), data.residence);

    // Link to profile
    tooltip
        .append("a")
        .attr("href", data.url)
        .attr("class", "bio-link")
        .text(t("View profile") + " \u2192");

    activeTooltip = tooltip;
}

function addFact(container, label, value, place) {
    if (!value && !place) return;

    const row = container.append("div").attr("class", "bio-fact");
    row.append("span").attr("class", "bio-fact-label").text(label);

    let display = value || "";
    if (place) {
        display += display ? `, ${place}` : place;
    }
    row.append("span").attr("class", "bio-fact-value").text(display);
}

function computeAge(data) {
    if (!data.birthYear) return "";

    const birthYear = parseInt(data.birthYear, 10);
    if (isNaN(birthYear)) return "";

    if (data.isDead) {
        if (data.deathYear) {
            const deathYear = parseInt(data.deathYear, 10);
            if (!isNaN(deathYear)) {
                const age = deathYear - birthYear;
                return t("Died at age %s", age);
            }
        }
        return t("Deceased");
    }

    const currentYear = new Date().getFullYear();
    const age = currentYear - birthYear;
    return t("Age ~%s", age);
}

function scheduleHide() {
    hideTimer = setTimeout(hideTooltip, 300);
}

/**
 * Hide the active tooltip.
 */
export function hideTooltip() {
    clearTimeout(hideTimer);
    if (activeTooltip) {
        activeTooltip.remove();
        activeTooltip = null;
    }
}

/**
 * Attach hover behavior to a person card group.
 *
 * @param {d3.Selection} cardGroup - The SVG <g> for the person card
 * @param {object} data - Person data
 * @param {string} containerSelector
 */
export function attachHoverBioCard(cardGroup, data, containerSelector) {
    cardGroup
        .on("mouseenter", function () {
            clearTimeout(hideTimer);
            showBioCard(data, this, containerSelector);
        })
        .on("mouseleave", () => {
            scheduleHide();
        });
}
