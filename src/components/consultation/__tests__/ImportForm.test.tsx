import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportForm } from "../ImportForm";

describe("ImportForm", () => {
  it("renders the form with key fields", () => {
    render(<ImportForm onSubmit={vi.fn()} isLoading={false} />);
    expect(screen.getByText("Description du produit *")).toBeInTheDocument();
    expect(screen.getByText("Valeur *")).toBeInTheDocument();
    expect(screen.getByText("Pays d'origine *")).toBeInTheDocument();
  });

  it("shows loading state on submit button", () => {
    render(<ImportForm onSubmit={vi.fn()} isLoading={true} />);
    expect(screen.getByText("Génération du rapport...")).toBeInTheDocument();
  });

  it("disables button when required fields are empty", () => {
    render(<ImportForm onSubmit={vi.fn()} isLoading={false} />);
    const btn = screen.getByRole("button", { name: /générer le rapport/i });
    expect(btn).toBeDisabled();
  });
});
