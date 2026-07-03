import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { makeStore } from "@/app/store";

export function renderWithProviders(ui: ReactElement, { route = "/" } = {}) {
  const store = makeStore();
  const result = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      <Toaster />
    </Provider>,
  );
  return { store, ...result };
}
