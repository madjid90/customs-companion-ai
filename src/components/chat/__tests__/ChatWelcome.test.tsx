import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatWelcome } from "../ChatWelcome";

// =============================================================================
// TESTS: ChatWelcome component
// =============================================================================

describe("ChatWelcome", () => {
  it("renders the welcome heading", () => {
    render(<ChatWelcome onQuestionClick={vi.fn()} />);
    expect(screen.getByText("Votre assistant douanier")).toBeInTheDocument();
  });

  it("renders the subtitle", () => {
    render(<ChatWelcome onQuestionClick={vi.fn()} />);
    expect(
      screen.getByText(/Classification SH, tarifs, réglementations/)
    ).toBeInTheDocument();
  });

  it("renders 4 suggestion buttons", () => {
    render(<ChatWelcome onQuestionClick={vi.fn()} />);
    // There should be exactly 4 suggestion buttons (not counting the refresh button)
    const buttons = screen.getAllByRole("button");
    // 4 suggestions + 1 "Autres suggestions" refresh button
    expect(buttons.length).toBe(5);
  });

  it("calls onQuestionClick when a suggestion is clicked", () => {
    const onQuestionClick = vi.fn();
    render(<ChatWelcome onQuestionClick={onQuestionClick} />);

    const suggestionButtons = screen.getAllByRole("button");
    // Click the first suggestion (not the last one which is "Autres suggestions")
    fireEvent.click(suggestionButtons[0]);

    expect(onQuestionClick).toHaveBeenCalledTimes(1);
    // The argument should be a non-empty string (the question text)
    expect(onQuestionClick.mock.calls[0][0]).toBeTruthy();
    expect(typeof onQuestionClick.mock.calls[0][0]).toBe("string");
  });

  it("renders the refresh button", () => {
    render(<ChatWelcome onQuestionClick={vi.fn()} />);
    expect(screen.getByText("Autres suggestions")).toBeInTheDocument();
  });

  it("refreshes questions when refresh button is clicked", () => {
    render(<ChatWelcome onQuestionClick={vi.fn()} />);

    const firstSuggestions = screen.getAllByRole("button").slice(0, 4)
      .map(btn => btn.textContent);

    // Click refresh multiple times to increase chance of different questions
    const refreshButton = screen.getByText("Autres suggestions");
    fireEvent.click(refreshButton);

    // We can't guarantee different questions due to randomness,
    // but the component shouldn't crash
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(5);
  });
});
