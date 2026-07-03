import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { LoginPage } from "@/features/auth/LoginPage";
import { renderWithProviders } from "@/test/testUtils";

function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<div>ANA SAYFA</div>} />
    </Routes>,
    { route: "/login" },
  );
}

describe("LoginPage", () => {
  it("validates inputs before submitting", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: "Oturum aç" }));
    expect(await screen.findByText("Geçerli bir e-posta girin")).toBeInTheDocument();
    expect(screen.getByText("Şifre gerekli")).toBeInTheDocument();
  });

  it("shows the backend error message on wrong credentials", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText("E-posta"), "owner@demo.co");
    await user.type(screen.getByLabelText("Şifre"), "yanlis");
    await user.click(screen.getByRole("button", { name: "Oturum aç" }));
    expect(await screen.findByText("E-posta veya şifre hatalı")).toBeInTheDocument();
  });

  it("stores the token and redirects on success", async () => {
    const user = userEvent.setup();
    const { store } = renderLogin();
    await user.type(screen.getByLabelText("E-posta"), "owner@demo.co");
    await user.type(screen.getByLabelText("Şifre"), "Demo1234!");
    await user.click(screen.getByRole("button", { name: "Oturum aç" }));

    await screen.findByText("ANA SAYFA");
    await waitFor(() => {
      expect(store.getState().auth.token).toBe("test-token");
      expect(localStorage.getItem("depo.token")).toBe("test-token");
    });
    expect(store.getState().auth.user?.email).toBe("owner@demo.co");
  });
});
