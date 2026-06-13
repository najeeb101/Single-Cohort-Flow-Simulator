"""One function per figure. All figures saved to outputs/figures/."""
from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker

if TYPE_CHECKING:
    from src.simulator import SimulationResult
    from src.models.course import Course


# ------------------------------------------------------------------ #
# Colour palette                                                      #
# ------------------------------------------------------------------ #
_SCENARIO_COLORS = {
    "A_baseline":          "#1f77b4",
    "B_pass_intervention": "#ff7f0e",
    "C_add_sections":      "#2ca02c",
    "D_uncontended":       "#9467bd",
}
_DEFAULT_COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#9467bd", "#8c564b"]


def _color(name: str, idx: int = 0) -> str:
    return _SCENARIO_COLORS.get(name, _DEFAULT_COLORS[idx % len(_DEFAULT_COLORS)])


# ------------------------------------------------------------------ #
# 1. Cohort funnel                                                    #
# ------------------------------------------------------------------ #

def plot_funnel(
    results: dict[str, SimulationResult],
    output_path: Path,
) -> None:
    # For a single scenario, show stacked area: enrolled / graduated / dropped / censored
    if len(results) == 1:
        name, result = next(iter(results.items()))
        snaps  = result.history.snapshots
        terms  = [s["term"] for s in snaps]
        total  = result.config["cohort_size"]

        enrolled  = [s["active"] + s["delayed"] for s in snaps]
        graduated = [s["graduated"] for s in snaps]
        dropped   = [s["dropped"] for s in snaps]
        censored  = [s.get("censored", 0) for s in snaps]

        fig, ax = plt.subplots(figsize=(10, 5))
        ax.stackplot(
            terms,
            enrolled, graduated, dropped, censored,
            labels=["Still enrolled", "Graduated", "Academic dropout", "Censored (hit horizon)"],
            colors=["#4878d0", "#6acc65", "#d65f5f", "#b47cc7"],
            alpha=0.85,
        )
        ax.axvline(8.5, color="black", linestyle="--", linewidth=1.2, label="On-time cutoff (sem 8)")
        ax.set_xlabel("Semester")
        ax.set_ylabel("Students")
        ax.set_title(f"Cohort Flow — {name}")
        ax.set_xlim(1, max(terms))
        ax.set_ylim(0, total)
        ax.yaxis.set_major_locator(mticker.MultipleLocator(10))
        ax.legend(loc="center left", fontsize=9)
        ax.grid(axis="y", linestyle="--", alpha=0.3)
        fig.tight_layout()
        fig.savefig(output_path, dpi=150)
        plt.close(fig)
        return

    # Multiple scenarios: lines only
    fig, ax = plt.subplots(figsize=(10, 5))
    for idx, (name, result) in enumerate(results.items()):
        snaps = result.history.snapshots
        terms     = [s["term"] for s in snaps]
        still_in  = [s["active"] + s["delayed"] for s in snaps]
        ax.plot(terms, still_in, marker="o", markersize=4,
                color=_color(name, idx), label=name, linewidth=2)
    ax.set_xlabel("Semester")
    ax.set_ylabel("Students still enrolled (Active + Delayed)")
    ax.set_title("Cohort Survivorship by Scenario")
    ax.set_xlim(left=1)
    ax.set_ylim(bottom=0)
    ax.yaxis.set_major_locator(mticker.MultipleLocator(10))
    ax.legend(fontsize=9)
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


# ------------------------------------------------------------------ #
# 2. Bottleneck chart                                                  #
# ------------------------------------------------------------------ #

def plot_bottlenecks(
    result: SimulationResult,
    output_path: Path,
    top_n: int = 8,
) -> None:
    h = result.history
    signal_names = ["Failures", "Capacity\nBlocks", "Offering\nBlocks", "Prereq\nBlocks"]
    counters = [h.fail_counts, h.capacity_block_counts, h.offering_block_counts, h.prereq_block_counts]
    colors   = ["#d62728", "#ff7f0e", "#1f77b4", "#9467bd"]

    fig, axes = plt.subplots(1, 4, figsize=(16, 5))

    for ax, signal, counter, color in zip(axes, signal_names, counters, colors):
        top = sorted(counter.items(), key=lambda x: -x[1])[:top_n]
        if not top:
            ax.set_visible(False)
            continue
        codes, counts = zip(*top)
        bars = ax.barh(list(codes)[::-1], list(counts)[::-1], color=color)
        ax.set_title(signal, fontsize=11)
        ax.set_xlabel("Count")
        ax.bar_label(bars, fmt="%d", padding=3, fontsize=8)
        ax.xaxis.set_major_locator(mticker.MaxNLocator(integer=True))

    name = result.scenario.get("name", "")
    fig.suptitle(f"Bottleneck Signals — {name}", fontsize=13, y=1.01)
    fig.tight_layout()
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)


# ------------------------------------------------------------------ #
# 3. Graduation histogram                                             #
# ------------------------------------------------------------------ #

def plot_graduation_histogram(
    results: dict[str, SimulationResult],
    output_path: Path,
) -> None:
    fig, ax = plt.subplots(figsize=(9, 5))

    all_times: list[int] = []
    for result in results.values():
        all_times.extend(result.history.graduation_times)
    if not all_times:
        plt.close(fig)
        return

    bins = range(min(all_times), max(all_times) + 2)

    for idx, (name, result) in enumerate(results.items()):
        times = result.history.graduation_times
        if times:
            ax.hist(times, bins=bins, alpha=0.55,
                    color=_color(name, idx), label=name, edgecolor="white")

    ax.axvline(8.5, color="red", linestyle="--", linewidth=1.5, label="On-time cutoff (≤8 sem)")
    ax.set_xlabel("Semesters to Graduate")
    ax.set_ylabel("Number of Students")
    ax.set_title("Time-to-Graduate Distribution")
    ax.legend(fontsize=9)
    ax.xaxis.set_major_locator(mticker.MaxNLocator(integer=True))
    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


# ------------------------------------------------------------------ #
# 4. Prerequisite / curriculum network                                #
# ------------------------------------------------------------------ #

def plot_curriculum_network(
    result: SimulationResult,
    curriculum: dict[str, Course],
    config: dict,
    output_path: Path,
) -> None:
    try:
        import networkx as nx
    except ImportError:
        return

    seed = config.get("seed", 42)
    h = result.history

    # Only show CS courses + electives (exclude non-CS noise)
    cs_codes = {
        code for code, c in curriculum.items()
        if c.category in ("cs_core", "cs_elective")
    }

    G = nx.DiGraph()
    for code in cs_codes:
        G.add_node(code)
    for code in cs_codes:
        course = curriculum[code]
        for pre in course.prerequisites:
            if pre in cs_codes:
                G.add_edge(pre, code)
        if course.is_senior_project and course.senior_project_rule:
            rule = course.senior_project_rule
            for req in rule.required:
                if req in cs_codes:
                    G.add_edge(req, code)
            for opt in rule.one_of:
                if opt in cs_codes:
                    G.add_edge(opt, code, style="dashed")

    fail_counts = h.fail_counts
    max_fails = max(fail_counts.values(), default=1)

    node_sizes = []
    node_colors = []
    for code in G.nodes:
        fails = fail_counts.get(code, 0)
        node_sizes.append(300 + 2000 * (fails / max_fails))
        node_colors.append(fails / max_fails)

    fig, ax = plt.subplots(figsize=(12, 8))
    pos = nx.spring_layout(G, seed=seed, k=2.5)
    nx.draw_networkx_nodes(
        G, pos, ax=ax,
        node_size=node_sizes,
        node_color=node_colors,
        cmap=plt.cm.YlOrRd,
        vmin=0, vmax=1,
    )
    # Solid edges
    solid_edges = [(u, v) for u, v, d in G.edges(data=True) if d.get("style") != "dashed"]
    dashed_edges = [(u, v) for u, v, d in G.edges(data=True) if d.get("style") == "dashed"]
    nx.draw_networkx_edges(G, pos, edgelist=solid_edges, ax=ax,
                           arrows=True, arrowsize=15,
                           edge_color="#555555", width=1.5)
    nx.draw_networkx_edges(G, pos, edgelist=dashed_edges, ax=ax,
                           arrows=True, arrowsize=12,
                           edge_color="#aaaaaa", width=1.0, style="dashed")
    nx.draw_networkx_labels(G, pos, ax=ax, font_size=7, font_color="black")

    sm = plt.cm.ScalarMappable(cmap=plt.cm.YlOrRd, norm=plt.Normalize(vmin=0, vmax=max_fails))
    sm.set_array([])
    plt.colorbar(sm, ax=ax, label="Failure count (node size ∝ fails)")
    ax.set_title(f"CS Curriculum Network — {result.scenario.get('name','')}")
    ax.axis("off")
    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


# ------------------------------------------------------------------ #
# 5. Curriculum stage flow (students per CH band over time)          #
# ------------------------------------------------------------------ #

def plot_curriculum_stage_flow(
    result: SimulationResult,
    output_path: Path,
) -> None:
    snaps = result.history.snapshots
    terms = [s["term"] for s in snaps]

    band_labels = ["0–29 CH (Year 1)", "30–59 CH (Year 2)", "60–89 CH (Year 3)", "90–119 CH (Year 4+)"]
    band_keys   = ["0-29", "30-59", "60-89", "90-119"]
    colors      = ["#4878d0", "#6acc65", "#ee854a", "#d65f5f"]

    fig, ax = plt.subplots(figsize=(10, 5))
    for label, key, color in zip(band_labels, band_keys, colors):
        values = [s.get("ch_bands", {}).get(key, 0) for s in snaps]
        ax.plot(terms, values, marker="o", markersize=4,
                label=label, color=color, linewidth=2)

    ax.set_xlabel("Semester")
    ax.set_ylabel("Students Still Enrolled")
    ax.set_title(f"Students by Curriculum Stage — {result.scenario.get('name', '')}")
    ax.legend(fontsize=9)
    ax.set_xlim(1, max(terms))
    ax.set_ylim(bottom=0)
    ax.yaxis.set_major_locator(mticker.MultipleLocator(10))
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


# ------------------------------------------------------------------ #
# Master save function                                                #
# ------------------------------------------------------------------ #

def save_all_figures(
    results: dict[str, SimulationResult],
    curriculum: dict[str, Course],
    config: dict,
    figures_dir: Path,
) -> None:
    figures_dir.mkdir(parents=True, exist_ok=True)

    plot_funnel(results, figures_dir / "funnel.png")
    print("  Saved funnel.png")

    plot_graduation_histogram(results, figures_dir / "graduation_histogram.png")
    print("  Saved graduation_histogram.png")

    # Bottleneck charts: one per scenario
    for name, result in results.items():
        plot_bottlenecks(result, figures_dir / f"bottlenecks_{name}.png")
        print(f"  Saved bottlenecks_{name}.png")

    # Network for baseline scenario
    baseline = results.get("A_baseline") or next(iter(results.values()))
    plot_curriculum_network(
        baseline, curriculum, config,
        figures_dir / "curriculum_network.png",
    )
    print("  Saved curriculum_network.png")

    # Stage flow: one per scenario
    for name, result in results.items():
        plot_curriculum_stage_flow(result, figures_dir / f"stage_flow_{name}.png")
        print(f"  Saved stage_flow_{name}.png")
