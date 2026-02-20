import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConsultationModeSelector } from "../ConsultationModeSelector";

describe("ConsultationModeSelector", () => {
  it("renders all 4 modes", () => {
    render(<ConsultationModeSelector selected="import" onSelect={vi.fn()} />);
    expect(screen.getByText("Import Standard")).toBeInTheDocument();
    expect(screen.getByText("MRE — Retour")).toBeInTheDocument();
    expect(screen.getByText("Conformités")).toBeInTheDocument();
    expect(screen.getByText("Investissement")).toBeInTheDocument();
  });

  it("calls onSelect when clicking a mode", () => {
    const onSelect = vi.fn();
    render(<ConsultationModeSelector selected="import" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("MRE — Retour"));
    expect(onSelect).toHaveBeenCalledWith("mre");
  });

  it("highlights the selected mode with indicator dot", () => {
    const { container } = render(<ConsultationModeSelector selected="conformity" onSelect={vi.fn()} />);
    // Active mode should have a colored dot indicator
    const dots = container.querySelectorAll(".bg-warning");
    expect(dots.length).toBeGreaterThan(0);
  });
});
